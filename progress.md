# FF Beacon Progress: Signal Scout

Single source of truth for atomic task status, currently scoped to the Signal Scout build
(plan: signal-scout-plan.md). Prior project task history (T001-T899, OTC-T*) was reset on
2026-07-09 and is preserved in git history of this file.

Update after every task. Task format:

```
SS-T### | status | description
     | files: ...
     | depends on: SS-T###
     | verified: yes/no (RLS verified, a11y audited, security reviewed)
```

Status: `pending` | `in_progress` | `blocked` | `completed`

Conventions for this feature:
- Every migration task includes: apply via MCP, save SQL to /supabase/migrations/, RLS policies
  in the same file, RLS verification sequence, types regeneration to /lib/database.types.ts.
- Every lib task includes its colocated *.test.ts coverage.
- Sub-agent reviews (implementation, accessibility, security) close each phase before its tasks
  are marked verified.

---

## Phase 0 - Discovery and data verification
SS-T000 | completed | Phase 0 discovery: live data coverage (draft 0%, high school 95.6%,
       jersey 98.2%, stats 2020-2025 loaded, projections empty, ADP live, pool 712), identity
       hierarchy mapped, stats helpers mapped, broken 0118 finishes RPC found. Full findings in
       signal-scout-plan.md Part 1.
     | verified: yes (read-only; no build)

## Phase 1 - Database and settings
SS-T001 | completed | Migration: signal_scout_settings (single-row JSONB, 0106 template) + RLS
     | files: supabase/migrations/0123_signal_scout_settings.sql, lib/database.types.ts
     | notes: exact 0106 template (id='global' single-row check, settings jsonb not null,
       updated_by fk auth.users on delete set null). Applied via MCP. Types regenerated via
       MCP and prettier-formatted.
     | verified: yes (RLS verified: pg_policies shows exactly signal_scout_settings_service_role_all
       for ALL to service_role; relrowsecurity true; anon and authenticated role simulations
       both return zero rows; signal_scout_settings present in database.types.ts with all
       pre-existing tables intact; npm run typecheck clean)
SS-T002 | completed | Migration: repair get_player_positional_finishes (coalesce nested/flat
       metadata paths; also fixes live player-page finishes)
     | files: supabase/migrations/0124_fix_get_player_positional_finishes.sql
     | notes: season_totals CTE now reads coalesce(nullif(metadata->'stats'->>key,'')::numeric,
       nullif(metadata->>key,'')::numeric, 0), matching lib/player-profile.ts readPoints.
       Signature, grants (anon+authenticated), security invoker, search_path unchanged.
       Applied via MCP. No types regen needed (signature unchanged).
     | verified: yes (live check on Ja'Marr Chase e9ddc6e9-c57f-4564-8c31-f0dd448af4ab:
       2024 pts_ppr finish 1 with 403.0 pts over 342 WRs ranked, 2023 pts_ppr finish 11
       with 262.72 pts; zero remaining total_points=0 rows; all-tied-at-1 artifact gone)
     | risk: live player-page finishes flip from zeroed ties to real finishes (expected
       improvement, additive fallback only, no caller changes needed)
SS-T003 | completed | Migration: signal_scout_rounds + RLS + partial unique active-round indexes
     | files: supabase/migrations/0125_signal_scout_rounds.sql, lib/database.types.ts
     | notes: all plan-19 columns with non-negative checks, one-identity XOR check
       (user_id/guest_id), status check (active/won/solved_late/failed/skipped),
       game_date defaults to ET day as safety net, ip_hash documented as salted SHA-256
       (raw IPs never stored). Applied via MCP; types regenerated.
     | verified: yes (RLS verified: only signal_scout_rounds_service_role_all ALL to
       service_role; relrowsecurity true; anon + authenticated simulations blocked;
       pg_indexes shows pkey + one_active_per_user/guest partial uniques + 4 supporting
       indexes; signal_scout_rounds present in database.types.ts with prior tables intact)
SS-T004 | completed | Migration: signal_scout_round_clues + RLS
     | files: supabase/migrations/0126_signal_scout_round_clues.sql, lib/database.types.ts
     | notes: composite pk (round_id, clue_key), tier check
       (starter/weak/clear/ping/scan), cost >= 0, display_value frozen at round start,
       index (round_id, tier, is_revealed). Service-role-only; header documents that
       unrevealed rows are answer data and clients only see revealed clues via DTOs.
       Applied via MCP; types regenerated.
     | verified: yes (RLS verified: only signal_scout_round_clues_service_role_all ALL
       to service_role; relrowsecurity true; anon + authenticated simulations blocked;
       pg_indexes shows pkey + round_tier_revealed idx; types file has
       signal_scout_round_clues with prior tables intact)
SS-T005 | completed | Migration: signal_scout_guesses + RLS
     | files: supabase/migrations/0127_signal_scout_guesses.sql, lib/database.types.ts
     | notes: pk (round_id, guessed_player_id) makes duplicate guesses impossible at the
       DB layer (backstops the API 409); unique (round_id, guess_number); indexes on
       guessed_player_id and created_at desc (admin aggregates + rapid-guess detection).
       Applied via MCP; types regenerated.
     | verified: yes (orchestrator re-verified live: pg_policies shows only
       signal_scout_guesses_service_role_all ALL to service_role; relrowsecurity true;
       anon and authenticated role simulations both see 0 rows; pg_indexes shows pkey +
       round_number_key + player_idx + created_idx; signal_scout_guesses present in
       database.types.ts at a top-level table key with all prior tables intact)
SS-T006 | completed | Migration: signal_scout_user_stats + RLS (select_own + service role)
     | files: supabase/migrations/0128_signal_scout_user_stats.sql, lib/database.types.ts
     | notes: user_id pk fk auth.users cascade; all plan-19 aggregate columns with
       non-negative checks; hidden_from_leaderboards + reason/at/by (hidden_by fk
       auth.users set null); leaderboard indexes on total_points desc and
       best_signal_streak desc are PARTIAL on hidden_from_leaderboards = false.
       First client-readable game table: select_own for authenticated
       (auth.uid() = user_id), all writes service-role lazy upserts. Applied via MCP;
       types regenerated.
     | verified: yes (orchestrator verified live: pg_policies shows select_own SELECT
       to authenticated with qual auth.uid() = user_id, plus service_role_all ALL;
       relrowsecurity true; anon and JWT-less authenticated simulations both see 0
       rows; pg_indexes confirms both partial indexes with where clauses;
       signal_scout_user_stats at line 3643 of database.types.ts with all prior
       tables intact; npm run typecheck clean)
SS-T007 | completed | Migration: signal_scout_daily_scores + RLS (select_own + service role)
     | files: supabase/migrations/0129_signal_scout_daily_scores.sql, lib/database.types.ts
     | notes: pk (user_id, game_date); points/rounds/wins non-negative; first_play_at
       set once per ET day (daily leaderboard tie-breaker); index (game_date, points
       desc); no per-row hidden flag by design (hiding joins signal_scout_user_stats).
       select_own + service_role_all mirroring user_stats. Applied via MCP; types
       regenerated.
     | verified: yes (agent-reported and SQL reviewed by orchestrator: pg_policies shows
       select_own SELECT to authenticated qual auth.uid() = user_id + service_role_all
       ALL; relrowsecurity true; anon and JWT-less authenticated simulations 0 rows;
       pg_indexes shows pkey + date_points_idx; signal_scout_daily_scores in
       database.types.ts with all prior tables intact)
SS-T008 | completed | Migration: signal_scout_player_overrides + RLS
     | files: supabase/migrations/0130_signal_scout_player_overrides.sql,
       lib/database.types.ts
     | notes: player_id pk fk players cascade, is_hidden default true (row presence is
       the override signal; unhide deletes or flips false), admin_note, updated_by fk
       auth.users set null, updated_at. No indexes beyond pk (serves the pool anti-join).
       Service-role-only; header documents the pool information-leak rationale.
       Applied via MCP; types regenerated.
     | verified: yes (agent-reported and SQL reviewed by orchestrator: only
       signal_scout_player_overrides_service_role_all ALL to service_role;
       relrowsecurity true; anon + authenticated simulations 0 rows; pkey only index;
       signal_scout_player_overrides in database.types.ts with all prior tables intact)
SS-T009 | completed | Migration: signal_scout_activity_counters + try_claim_signal_scout_action +
       try_start_signal_scout_guest_round RPCs + RLS
     | files: supabase/migrations/0131_signal_scout_activity_counters.sql,
       lib/database.types.ts
     | notes: counters pk (identity_key, action, game_date) with namespaced keys
       (user:/guest:/ip:), count + last_at min-interval claim semantics documented
       (per-minute limits expressed as min-interval equivalents by callers).
       try_claim_signal_scout_action is the 0111 claim-and-cooldown shape (count/last_at
       change only on successful claim). try_start_signal_scout_guest_round enforces
       max(guest count, ip count) < limit atomically, locks the two counter rows in
       deterministic key order via sequential FOR UPDATE (ORDER BY inside one locking
       query does not control lock order in Postgres), null ip_hash degrades to
       guest-only enforcement (never a bypass). Both RPCs SECURITY DEFINER with the
       0114 lockdown: revoke from public + anon + authenticated, grant service_role only.
     | verified: yes (RLS verified: only service_role_all policy, relrowsecurity true,
       anon/authenticated table simulations 0 rows; grants verified two ways:
       routine_privileges shows only postgres + service_role EXECUTE, and orchestrator
       direct-invoked both RPCs as anon and authenticated getting permission denied
       42501; functional tests: claim true then false inside window with count 1;
       guest cap true/true/false at limit 2 and rotated-cookie same-IP call denied,
       counters at exactly 2, failed calls did not increment; all 4 test rows cleaned,
       table empty; types file has counters table + both functions with all prior
       tables intact; npm run typecheck clean)
SS-T010 | completed | lib/signal-scout/settings.ts (types, defaults, Zod schema, loader) + tests
     | depends on: SS-T001
     | files: lib/signal-scout/types.ts, lib/signal-scout/default-settings.ts,
       lib/signal-scout/settings.ts, lib/signal-scout/settings.test.ts
     | notes: exact plan-18 shape (snake_case keys per plan spec, deliberately no
       minimum_correct_score), Zod schema with per-field defaults so partial rows merge
       onto defaults, loader reads id='global' via service-role client with maybeSingle
       and falls back to DEFAULT_SIGNAL_SCOUT_SETTINGS on missing row / error / invalid
       payload (FAAB/OTC pattern), validateSignalScoutSettings for the admin save path.
       No OTC-style clamp helper (FAAB does not have one either; can add later).
     | verified: yes (npx vitest run lib/signal-scout/settings.test.ts: 17 passed,
       re-run by orchestrator; npm run typecheck clean; no banned punctuation)

PHASE 1 CLOSED 2026-07-09. Implementation review: PASS (no plan deviations, no
punctuation violations, types file column-for-column match, FK behaviors coherent).
Security review: PASS, zero critical/high/medium findings; RLS verified live with
positive AND negative controls (real rows in rolled-back transactions: anon and
non-owner authenticated see 0 rows everywhere, owner sees own user_stats/daily_scores
row), both SECURITY DEFINER RPCs denied to anon/authenticated (42501), no injection
surface, no secrets in lib/signal-scout/. Three informational flags carried forward
as PHASE 3 ROUTE OBLIGATIONS:
  1. Routes must ALWAYS supply a non-empty ip_hash to try_start_signal_scout_guest_round
     (null/empty degrades to cookie-only enforcement).
  2. Never pass client-controlled values as p_window_seconds / p_limit to either RPC
     (negative window disables the cooldown, fails open).
  3. p_limit <= 0 blocks all guest rounds (fails closed; availability note only).

## Phase 2 - Core game engine (lib/signal-scout/)
SS-T011 | completed | eligibility.ts (pool rules + per-check explanations) + tests
     | files: lib/signal-scout/eligibility.ts, lib/signal-scout/eligibility.test.ts
     | notes: pure core evaluatePlayerEligibility (5 checks with admin-renderable detail
       sentences: position, rankings_window, required_fields, clue_coverage, not_hidden)
       + loadEligiblePool loader (positions filter, 90-day rankings window mirroring
       lib/player-search.ts generated_at pattern with explicit high limits vs the
       1000-row default, hidden overrides). clueCoverage is a typed seam: omitted from
       loader output (type-enforced layering), null fails as "not computed" until
       SS-T013 supplies real counts. years_experience 0 counts as present. Coverage
       thresholds: 3+ starter candidates, 2+ generatable per paid tier.
     | verified: yes (22 vitest tests pass, re-run by orchestrator with streaks suite;
       typecheck clean; column names verified against database.types.ts
       (height_inches/weight_lbs) and window column verified against player-search.ts)
SS-T012 | completed | stats-bundle.ts (2020+ season loading, aggregateSeasons reuse,
       pointsPerGame, career highs since 2020, finishes via fixed RPC) + tests
     | depends on: SS-T002
     | files: lib/signal-scout/stats-bundle.ts, lib/signal-scout/stats-bundle.test.ts,
       vitest.config.ts (infra fix, see notes)
     | notes: loadStatsBundle queries player_stats 2020+ regular season locally
       (loadWeeklyStats unmodified), maps via a documented third hand-synced toGameRow
       copy (stats-tab.tsx and load-stats.ts copies verified byte-identical), reuses
       imported aggregateSeasons + readPoints, exports pointsPerGame (toFixed(1),
       null at 0 games) and deriveCareerHighs (ties keep more recent season);
       finishes via the fixed RPC, PPR-only, bestFinish lowest finish; RPC and query
       failures degrade gracefully with [signal-scout] console.error (query-error log
       added by orchestrator review). INFRA: vitest.config.ts gained an oxc jsx
       automatic-runtime override because tsconfig jsx preserve (required by Next)
       breaks vitest transforms of imported .tsx modules; first attempt with the
       esbuild option was ignored by vitest 4 (oxc pipeline); full suite re-run after
       the change: 39 files, 457 tests, all pass, so no regression.
     | verified: yes (12 vitest tests pass re-run after review fix; full suite 457
       pass; typecheck clean; code reviewed against plan sections 10-11)
SS-T013 | completed | clues.ts (taxonomy, gating, display rendering, starter selection with
       specificity budget) + tests
     | depends on: SS-T012
     | files: lib/signal-scout/clues.ts, lib/signal-scout/clues.test.ts
     | notes: 37-key catalog (CLUE_DEFINITIONS) with plan-10 tier assignments,
       categories bio/team/stat/value, per-key specificity 1-5, starter eligibility per
       the plan's S markers. Data gating throughout (team null, missing high
       school/jersey, no stats, data_points_30d < 7, no ADP). Value facts use the fixed
       combo: player_value_trends source='ffbeacon' + format_config_id resolved from
       slug dynasty-ppr-sflex, per-player ktc fallback, sourceUsed recorded; overall
       rank from rankings.overall_rank; ADP from player_market_snapshots.adp jsonb
       (dynasty_2qb key). Starter selection: injectable rng, one per category, explicit
       conference+position_group and exact_age+age_range exclusions,
       STARTER_SPECIFICITY_BUDGET=6, floor of one clue with specificity >= 2.
       computeClueCoverage feeds the eligibility seam; applyDisabledKeys before
       coverage and selection. Deviations accepted after review: single named season
       for the stat-exact family (clue-key stability vs the unique(round_id, clue_key)
       constraint; plan allowed "one or two"); season_stat_exact expanded to 9
       position-gated concrete keys; 250-yard total-yards bucket (plan silent);
       position_group revised after orchestrator review to the plan's skip branch (QB
       targets never emit it; RB/WR/TE render "Not a quarterback", specificity 1)
       because a constant string was information-free and a QB-distinct string would
       meta-leak. Snap-share and red-zone clues deferred to SS-T047 (StatsBundle lacks
       the fields).
     | verified: yes (47 vitest tests pass, re-run by orchestrator after the
       position_group revision; typecheck clean; catalog reviewed against plan
       section 10 tier tables)
SS-T047 | pending | Follow-up from SS-T013: snap-share-range and red-zone-usage clues
       (plan section 10, Ping tier, "where populated") are NOT in the MVP clue catalog
       because StatsBundle aggregates only StatLine fields (no snap_pct aggregation, no
       red-zone attempt fields; red-zone data availability in player_stats.metadata is
       unverified). Requires a stats-bundle.ts extension plus clue additions. Needs
       owner confirmation on priority; coverage gates are satisfiable without them
       (Ping tier still has 5 clue types).
     | depends on: SS-T012, SS-T013

SS-T014 | completed | scoring.ts (dead-signal model: clamp 0, no floor, burn boundary,
       won vs solved_late) + tests
     | files: lib/signal-scout/scoring.ts, lib/signal-scout/scoring.test.ts
     | notes: pure functions, zero I/O. evaluateHintPurchase enforces the plan-13 check
       order (signal_burned, tier_limit_reached, tier_exhausted,
       burn_confirmation_required) with cost >= score requiring confirmBurn (exact-cost
       boundary burns); applyWrongGuess (flat penalty, clamp 0, strikes count at 0
       score); resolveCorrectGuess (won at >= 1 awards remaining, solved_late at 0);
       tierCost, maxTheoreticalSpend (2200 with defaults). tier_disabled lives in the
       shared HintErrorCode union but is produced at the route/engine layer
       (disabled_clue_keys is per clue key, not available to this pure function;
       documented in the doc comment).
     | verified: yes (24 vitest tests pass, re-run by orchestrator; typecheck clean;
       code reviewed against plan sections 5, 7, 13 and decisions 8-12)
SS-T015 | completed | streaks.ts (Signal Streak, Daily Scout Streak, ET boundaries) + tests
     | files: lib/signal-scout/streaks.ts, lib/signal-scout/streaks.test.ts
     | notes: pure functions. applyRoundOutcomeToStreaks: signal streak +1 only on won,
       reset on solved_late/failed/skipped; daily streak marks any completed round,
       same-day no-op, consecutive ET day +1, gap resets to 1; best streaks
       monotonic. isConsecutiveDay uses UTC-noon parsing (DST-proof).
       currentEasternGameDate uses Intl.DateTimeFormat with SITE_TIME_ZONE from
       lib/datetime.ts (never a bare toLocaleDateString). DST boundaries tested with
       concrete instants (spring-forward, fall-back, EST/EDT midnight edges).
     | verified: yes (25 vitest tests pass, re-run by orchestrator; typecheck clean;
       code reviewed against plan section 6 and decision 9)
SS-T016 | completed | round-engine.ts (start/hint/guess/skip/complete transactions, idempotent
       transitions, DTO builders) + tests
     | depends on: SS-T010, SS-T011, SS-T013, SS-T014, SS-T015
     | files: lib/signal-scout/round-engine.ts, lib/signal-scout/round-engine.test.ts
     | notes: service-role orchestration layer. Consistency model documented in header:
       no supabase-js transactions, so status-guarded anchor writes
       (id + status=active + score_available optimistic guard) written BEFORE any
       secondary write; guard miss returns round_not_active; crash between writes can
       leave stats one round behind but never double-awards or resurrects a round.
       startRound: game_enabled gate, active-round resume signal, lazy-verify weighted
       target selection (top-150 weight 4 vs tail 1 on ffbeacon dynasty-ppr-sflex
       ranks, last-10 target exclusion, coverage verified on the picked player only,
       5 reroll attempts), 23505 on the partial unique index resolved to
       active_round_exists, starters inserted revealed at cost 0 with reveal_order,
       paid clues at snapshot costs. purchaseHint: tier_disabled from the FROZEN
       settings_snapshot, scoring.evaluateHintPurchase passthrough, one random reveal,
       burned_out_at stamped once. submitGuess: duplicate free, out-of-pool check
       (snapshot positions + rankings window), wrong-guess drain/fail, correct split
       won vs solved_late, stats/streaks/daily upserts for users only (guests skip),
       first_play_at and first_played_at preserved on existing rows. Anti-cheat DTO
       invariant documented and serialization-tested (no target, no unrevealed
       clue content, no specificity, no snapshot in ActiveRoundDto). Guest daily cap
       claim explicitly left to Phase 3 routes (RPC boundary documented).
     | verified: yes (post-revision: 41 round-engine tests pass, 188 across
       lib/signal-scout, full suite 545 across 41 files; typecheck clean; orchestrator
       read the full module and reviewed transitions, guards, ownership, DTO surfaces
       against plan sections 3, 5, 12-15, 19)
     | revision (from Phase 2 closing reviews): (1) ActiveRoundDto now carries optional
       streaks for logged-in rounds (plan-12 pre-completion payload contract; guests
       omit; loadStreaksForRound lives in buildActiveDto, buildCompletedDto inherits
       post-update values); (2) applyStatsAndStreaks credits the ET COMPLETION day
       (currentEasternGameDate at completion) for streaks and daily_scores, while
       round.game_date keeps the start day for the guest cap; (3) security fix: runtime
       isSignalTierKey guard at the top of purchaseHint returns new EngineError
       invalid_tier, preventing NaN score corruption from an out-of-enum tier
       (defense in depth; Phase 3 still zod-validates). Six tests added covering
       solved_late integration, tier_exhausted and burn_confirmation_required
       pass-through, completion-day attribution with a stale start date, streaks
       presence/omission with anti-cheat re-assertion, and the bogus-tier guard.

PHASE 2 CLOSED 2026-07-09. Implementation review: PASS with notes (both findings
fixed in the SS-T016 revision above; punctuation scan clean; test-quality gaps
closed). Security review: PASS, zero critical/high; the one medium finding
(unvalidated tier) fixed at the engine layer same-day; anti-cheat invariant confirmed
structurally and via serialization tests (no target/unrevealed-clue/specificity/
snapshot leakage on any pre-completion path; no ownership existence oracle; duplicate
guesses cannot probe correctness; guarded writes close double-award and free-hint
races). PHASE 3 ROUTE OBLIGATIONS from these reviews (additive to the Phase 1 list):
  1. Zod-validate tier against ["weak","clear","ping","scan"], roundId and
     guessedPlayerId as UUIDs, confirmBurn as strict boolean; never rely on TS casts.
  2. Rate-limit POST /round tightly (worst case ~50 queries per start), plus the
     plan-13/14 limits (hints 10/min per round, guesses ~1 per 2s) via
     try_claim_signal_scout_action; run the guest-cap RPC BEFORE startRound (the
     engine deliberately does not enforce the guest daily cap).
  3. Require the x-requested-with: ff-beacon CSRF header on all mutations; map
     unexpected engine throws to generic errors (never echo raw DB error text).

## Phase 3 - API routes (app/api/games/signal-scout/)
SS-T017 | completed | POST /round (identity, guest cookie mint, guest claim, pool pick) + tests
     | depends on: SS-T016
     | files: app/api/games/signal-scout/round/route.ts + route.test.ts,
       lib/signal-scout/route-helpers.ts + route-helpers.test.ts,
       lib/signal-scout/round-engine.ts (findActiveRoundId export only),
       .env.local.example (SIGNAL_SCOUT_IP_SALT line)
     | notes: shared route-helper layer for all Phase 3 routes (header guard,
       privateJson no-store headers, clientIp, salted sha256 hashGuestIp with
       SIGNAL_SCOUT_IP_SALT env + documented fallback, resolveRoundIdentity with
       session-first then uuid-validated guest cookie then fresh mint,
       identityKeyFor, engineErrorStatus 16-code map, claimAction wrapper, zod
       schemas). Route order: header 403, identity, game_disabled 503,
       guest_play_disabled 403, RESUME CHECK before any claim (findActiveRoundId
       export added to engine so a double Start never burns a guest cap slot),
       round_start rate claim 5s window 429, guest cap RPC with non-empty ip_hash
       429, engine startRound with 23505 race to 409. Minted guest cookie set on
       every response path including errors. try/catch maps throws to generic 500.
     | verified: yes (80 tests pass across route + helpers + engine, re-run by
       orchestrator; typecheck clean; route and helpers code fully reviewed;
       all Phase 1/2 security obligations implemented: non-empty ip_hash asserted
       in tests, server-constant window/limit values, no raw DB text in responses)
SS-T018 | completed | GET /round/[id] + tests
     | files: app/api/games/signal-scout/round/[id]/route.ts + route.test.ts
     | notes: header guard (uniform even on GET, documented), uuid validation maps
       malformed ids to not_found (no id-shape oracle), no cookie mint on GET,
       engine getRound decides active vs completed DTO, generic 500 on throws.
     | verified: yes (7 tests pass, re-run by orchestrator; typecheck clean per agent;
       route code reviewed: no leak paths, no Set-Cookie, engineErrorStatus mapping)
SS-T019 | completed | POST /round/[id]/hint (tier limits, confirmBurn) + tests
     | files: app/api/games/signal-scout/round/[id]/hint/route.ts + route.test.ts
     | notes: header guard, uuid path validation to not_found, defensive JSON parse +
       zod body { tier, confirmBurn default false } rejected before any DB work, hint
       rate claim 6s window (documented as the min-interval equivalent of the plan's
       10/min-per-round: one active round per identity), purchaseHint passthrough with
       the exact plan-13 six-field success payload, typed error mapping, generic 500.
       Orchestrator review fix: moved resolveRoundIdentity inside the try block so a
       transient auth failure returns the generic server_error JSON instead of an
       unhandled route exception (matches the guess route).
     | verified: yes (12 tests pass, re-run by orchestrator after the fix; typecheck
       clean per agent; route code reviewed)
SS-T020 | completed | POST /round/[id]/guess (won vs solved_late) + tests
     | files: app/api/games/signal-scout/round/[id]/guess/route.ts + route.test.ts
     | notes: header guard, uuid path + body validation (malformed JSON and non-uuid
       guessedPlayerId both 400 invalid_request before any engine call), guess rate
       claim 2s window, submitGuess passthrough (active DTO on survivable wrong guess,
       completed DTO with reveal on won/solved_late/failed), typed error mapping,
       generic 500.
     | verified: yes (14 tests pass, re-run by orchestrator; typecheck clean per
       agent; route code reviewed)
SS-T021 | completed | POST /round/[id]/skip + tests
     | files: app/api/games/signal-scout/round/[id]/skip/route.ts + route.test.ts
     | notes: header guard, uuid validation to not_found, no rate claim (documented:
       plan-15 claims cover starts/guesses/hints/search only; skip is once-per-round
       via the engine status guard), skipRound passthrough with reveal, generic 500.
     | verified: yes (7 tests pass, re-run by orchestrator; typecheck clean per agent;
       route code reviewed)
SS-T022 | completed | GET /search (searchFantasyPlayers wrapper, rate claim) + tests
     | files: app/api/games/signal-scout/search/route.ts + route.test.ts
     | notes: header guard, query sanitized (50-char cap + house regex strip keeping
       the ilike or-filter injection-safe), sub-2-char queries return empty without
       spending a claim, 1s search claim window (Phase 4 combobox must debounce >= 1s
       or tolerate 429s), searchFantasyPlayers with eligible-positions filter + 10
       cap, result shape { id, name, position, team, sleeperId } via the house
       readSleeperId helper (public round-independent data). Orchestrator-directed
       security fix applied: cookie-less callers mint a fresh guest id per request,
       which made the per-identity claim key never repeat and the rate limit
       bypassable; freshly-minted-guest requests now claim on ip:<hash> while
       cookie-carrying guests and users keep per-identity keys (asserted in tests
       for both cases).
     | verified: yes (11 tests pass including two dedicated claim-key cases for the
       cookie-less ip: key and the stable guest: key, re-run by orchestrator after
       the fix; typecheck clean; route code reviewed)
SS-T023 | completed | GET /leaderboards + GET /me/stats + tests
     | depends on: SS-T006, SS-T007
     | files: app/api/games/signal-scout/leaderboards/route.ts + route.test.ts,
       app/api/games/signal-scout/me/stats/route.ts + route.test.ts
     | notes: three boards per plan-8 (daily/all_time/streak) with the exact orderings
       and tie-breakers, 25/page via range, page-aware ranks, master + per-board
       enabled flags 503, require_login 401, cross-table hidden/admin exclusion via a
       pre-fetched user_id set applied uniformly (daily_scores has no hidden flag by
       design), your-rank strip 1 + strictly-better count with own row stats,
       unstable_cache 60s around ONLY the shared board query keyed by
       (board, page, ET date). Raw auth user ids never serialized: rows carry a
       deterministic Scout-XXXX placeholder via exported scoutFallbackLabel, marked
       for SS-T032's real identity resolver to replace in Phase 5. me/stats: login
       required, own aggregates camelCased with moderation columns
       (hidden_reason/at/by) deliberately excluded, never-played is 200 stats null.
     | verified: yes (21 tests pass across both routes, re-run by orchestrator;
       typecheck clean per agent; both route files fully reviewed: no raw-id leak
       paths, safe NOT IN construction from DB-sourced uuids, cache scoped to the
       shared query only)

PHASE 3 CLOSED 2026-07-09. Implementation review: PASS (one consistency nit, the hint
route's literal 429, fixed by orchestrator to engineErrorStatus("rate_limited");
punctuation scan clean across all 19 files; test quality confirmed strong with
security-relevant assertions, not just happy paths). Security review: PASS, zero
critical/high; all accumulated Phase 1+2 obligations verified discharged with
file:line evidence (non-empty ip_hash, server-constant windows/limits, zod validation
at routes plus engine guards, uniform header guard, generic 500s). Four informational
findings, none blocking:
  1. clientIp trusts the leftmost x-forwarded-for entry (pre-existing house pattern,
     shared with OTC). Safe on Vercel where the edge sets the header; OPERATIONAL
     FOLLOW-UP: empirically confirm prod overwrites client-supplied XFF, and revisit
     if a CDN/WAF is ever placed in front of Vercel. This header is the sole backstop
     against guest-cookie rotation.
  2. scoutFallbackLabel is a 16-bit truncated hash: visible label collisions expected
     at ~256 users; cosmetic, replaced by SS-T032 in Phase 5.
  3. searchFantasyPlayers relies on caller-side sanitization by contract; our route's
     allowlist regex is sufficient. Optional future hardening of the shared lib.
  4. Leaderboard cache means a newly hidden/admin user can appear for up to 60s
     (moderation lag only).
PHASE 4 OBLIGATION: the search combobox must debounce >= 1s or hold last results on
429. PHASE 5 OBLIGATION: SS-T032 replaces every scoutFallbackLabel call site.
Final state: 656 tests across 50 files pass, typecheck clean.

## Phase 4 - Frontend game UI (/games/signal-scout)
SS-T024 | completed | Server page + client root + status bar tiles
     | depends on: SS-T017
     | files: app/games/signal-scout/page.tsx, app/games/signal-scout/signal-scout-client.tsx,
       app/games/signal-scout/status-bar.tsx, lib/signal-scout/client.ts,
       lib/signal-scout/client.test.ts
     | notes: typed browser API wrapper (ff-beacon header + no-store on every call,
       19-code typed error map with game-voice messages, active_round_exists roundId
       passthrough, AbortSignal-aware search). Server page: force-dynamic, own metadata,
       server-rendered hero (eyebrow "Games, Signal Scout" with a comma, never the house
       middot, per the ASCII punctuation rule), settings gate to a SignalOfflineNotice,
       identity resolution mirroring route-helpers (session, then uuid-validated guest
       cookie + ip hash from next/headers), server-side resume via findActiveRoundId +
       getRound, logged-in streaks from signal_scout_user_stats, guest rounds remaining
       from activity counters (max of guest and ip counts). Client root: plain useState
       state machine (idle/active/completed/guest_limit/offline), 409 active_round_exists
       handled as a resume (fetchRound), guest_limit_reached and game_disabled/pool_empty
       branch to dedicated phases, polite sr-only live region seam, session-scoped guest
       streak state seam for SS-T028/29, OTC cockpit shell on all panels, TODO seams named
       for SS-T025 through SS-T029. Status bar: Panel + StatReadout dl grid, gradient mono
       score tile (red plain "0" when burned), Bad Reads pips paired with visible
       "n of max" text (never color-only), guest tile + save-streaks footnote, all tiles
       visible at every breakpoint. All round-engine imports in client files are
       type-only (verified).
     | verified: yes (orchestrator re-ran: vitest client.test.ts 10/10 pass, npm run
       typecheck clean, banned-punctuation grep clean on all new files; all four files
       read and reviewed against the DTO/error contracts and anti-cheat invariant)
     | risk: no /signup route exists (app/login toggles sign-in/sign-up client-side, no
       query param to open signup mode), so guest CTAs point both buttons at /login;
       flagged for a one-click signup entry as a post-Phase-4 nicety. npm run lint is
       interactive (no eslint config in repo, pre-existing); excluded from verification.
SS-T025 | completed | Mystery profile card + revealed clue grid + locked slots
     | depends on: SS-T024
     | files: app/games/signal-scout/mystery-profile-card.tsx,
       app/games/signal-scout/clue-grid.tsx, app/games/signal-scout/locked-slots.tsx,
       app/games/signal-scout/signal-scout-client.tsx, app/globals.css
     | notes: profile card renders zero round data (generic UserRound silhouette with
       new .scout-scanline treatment, aria-hidden redaction bars, sr-only "Mystery
       player, identity classified" heading). Scanline CSS follows the house
       otc-onclock-cell precedent: static repeating-line texture on the element, slow
       cyan sweep on ::after, prefers-reduced-motion block removes only the sweep and
       keeps the static texture. Clue grid sorts starters (null revealOrder) first,
       tier chips always pair tone with the tier display name (TIER_DISPLAY_NAMES
       exported for SS-T026), newest cell gets motion-safe ring/glow plus
       id clue-cell-<clueKey>, tabIndex -1, and data-newest for SS-T026 focus moves.
       Locked slots: per-tier rows with lock icon plus "Signal Locked" text, locked
       count, mono cost, buys left, disabled reasons as text, and a full aria-label
       per row (plan-26 programmatic labels). newestClueKey state seam added to the
       client root (unused until SS-T026). DTO tier string narrowed via
       isClueTierChipKey with a safe fallback rather than a blind cast.
     | verified: yes (orchestrator re-ran typecheck clean and read all three
       components, the client integration, and the globals.css block including the
       reduced-motion fallback; agent ran vitest lib/signal-scout 223 pass and
       banned-punctuation scan clean)
SS-T026 | completed | Hint controls + burn-confirmation dialog
     | depends on: SS-T025
     | files: app/games/signal-scout/hint-controls.tsx,
       app/games/signal-scout/burn-confirm-dialog.tsx,
       app/games/signal-scout/signal-scout-client.tsx
     | notes: four tier buttons (2x2 mobile grid, lg 4-up) with cost pills and
       remaining-purchase counts; burn-warning state (signal-warning tone, Flame icon,
       "Burns out signal" text, expanded aria-label) when cost >= score; disabled
       reasons rendered as text inside the button (priority burned > exhausted >
       limit). Burn round trip per handoff obligation 4: client-side cost >= score
       check opens the SlideUpDialog confirm ("Confirm signal burnout", Cancel is the
       first focusable so the safe choice gets initial focus), confirm re-sends with
       confirmBurn: true, and a server-side 409 burn_confirmation_required also opens
       the dialog (stale-client catch, never an error). Success path: single immutable
       setRound (clue appended, score/burned/lockedCounts/purchasesRemaining), polite
       live-region announcement of label + value + score, newestClueKey set, focus
       moved to clue-cell-<key> on a 120ms defer so SlideUpDialog focus-restore lands
       first. round_not_active/not_found resync via fetchRound and flip to completed
       when the round finished elsewhere. Agent deviations accepted by orchestrator:
       all four buttons disable while any purchase is pending (prevents silent no-op
       clicks), explicit re-entrancy guard in handlePurchaseHint, handleStartRound
       clears stale hintError.
     | verified: yes (orchestrator re-ran typecheck clean; read both new components
       and the full wiring region; verified burn dialog focus order against
       slide-up-dialog.tsx focus code, single setRound, no target data on any
       pre-completion path; agent ran vitest lib/signal-scout 223 pass and
       banned-punctuation scan clean)
SS-T027 | completed | Guess combobox + Bad Reads ruled-out list (+ skip action)
     | depends on: SS-T026
     | files: app/games/signal-scout/guess-combobox.tsx,
       app/games/signal-scout/bad-reads.tsx,
       app/games/signal-scout/signal-scout-client.tsx
     | notes: WAI-ARIA combobox cloned from the asset-autocomplete pattern
       (Signal Scout specific, not imported): 1000ms debounce with AbortController
       cancellation, min length 2 mirroring the route short-circuit, and the Phase 4
       search obligation satisfied both ways (debounce >= 1s AND 429 rate_limited
       holds the last results without clearing or erroring). Results render
       PlayerHeadshot + name + "POS, TEAM" (FA when team null); ruled-out players
       stay visible with aria-disabled + "Ruled out" badge, are skipped by keyboard
       navigation helpers, and commit() guards them against forced mousedown.
       Bad Reads chips: danger-toned pills with per-chip "Ruled out: name" labels
       (visible content aria-hidden to avoid double announcement). Client root:
       handleSubmitGuess (wrong guess announces bad-read count and score from the
       RETURNED round; completion sets phase, announces headline + target name +
       points when won), handleSkipRound (secondary button with always-visible
       consequence line "Ends the round with no score. Your Signal Streak resets."),
       both with round_not_active/not_found resync mirroring the hint flow. Guest
       session streaks now real: applyRoundOutcomeToStreaks + currentEasternGameDate
       imported as values from lib/signal-scout/streaks (verified pure and
       client-safe, no supabase imports), fed via a guestLastPlayedDate state;
       CompletedStatus and RoundOutcome are the same union so no cast. Skip was not
       named in any SS-T### row; assigned here by the orchestrator since it
       completes the guess-area controls (plan section 3 loop: buy, guess, or skip).
     | verified: yes (orchestrator re-ran typecheck clean; read guess-combobox.tsx
       in full, the streaks signature against its call site, and the guess/skip
       wiring region; confirmed no target data pre-completion, ruled-out keyboard
       skip, and 429 hold behavior; agent ran vitest lib/signal-scout 223 pass and
       banned-punctuation scan clean)
SS-T028 | completed | Score meter + Burned Out banner
     | depends on: SS-T027
     | files: app/games/signal-scout/score-meter.tsx,
       app/games/signal-scout/burned-banner.tsx,
       app/games/signal-scout/signal-scout-client.tsx, app/games/signal-scout/page.tsx
     | notes: meter follows the trade-margin-graph pattern (aria-hidden bar plus one
       sr-only plain-language summary): beacon gradient fill, 4 percent visibility
       floor except a true-zero renders empty, 2px danger burn marker at the left
       edge with a visible "0, burn point" flanking label and Flame icon, visible
       mono "score / max" readout so the state is never color-only, burned state
       swaps label and track tone to danger. Meter max comes from a new
       startingScore prop (live settings.scoring.starting_score, commented as
       cosmetic scale only; the frozen round snapshot governs real scoring).
       BurnedBanner: role="alert" strip (announces assertively exactly once on
       mount, no duplicate announce() call) merging the plan-13 banner copy with
       the plan-26 announcement content: "Signal burned out. You can still name
       the player, but this round can no longer score. Hints are locked." Active
       panel order now matches plan section 21: profile card, clue grid, locked
       slots, hint error, hint controls, burned banner (conditional), guess error,
       combobox, bad reads, skip row, score meter.
     | verified: yes (orchestrator re-ran typecheck clean and read both components;
       agent ran vitest lib/signal-scout 223 pass, banned-punctuation scan clean,
       and confirmed the render order by re-reading the file)
SS-T029 | completed | Result reveal card (4 outcomes) + next-round / guest signup CTA
     | depends on: SS-T028
     | files: app/games/signal-scout/result-card.tsx,
       app/games/signal-scout/clue-grid.tsx, app/games/signal-scout/signal-scout-client.tsx,
       app/games/signal-scout/page.tsx
     | notes: ResultCard on the trade-result ResultHero pattern with tone-by-outcome
       border/glow/eyebrow: won (cyan, gradient "Signal Found" headline with plain
       aria-label, gradient scoreAwarded numeral, static cyan shadow, Clean Read
       badge only at zero wrong guesses), solved_late / failed / skipped carry the
       plan-13 sublines verbatim (failed uses "Three Bad Reads" only when the max is
       actually 3). Player reveal via PlayerHeadshot honoring a new showPlayerImages
       prop (settings.reveal.show_player_images; sleeperId null renders the house
       silhouette). Streak chips with text "+1"/"reset" markers, Bad Reads reuse,
       and the full clue sheet via ClueGrid extended with backward-compatible
       heading/headingId/unseenKeys props (never-revealed cells get dashed-muted
       treatment plus a "Never revealed" text chip). Focus moves to the result
       heading only on the phase TRANSITION into completed (previousPhaseRef +
       double rAF). Fixed the SS-T024 staleness gap: guestRoundsLeft state decrements
       on fresh round starts only (resume path never decrements), feeds the status
       bar and CTAs. Completed phase: guest at 0 rounds gets the signup wall card
       instead of the Next round button; guests with rounds left see a "{n} guest
       rounds left today" note. Cockpit-shell wrapper dropped around the completed
       phase in favor of ResultCard's own rounded-modal shell (no card-in-card).
     | verified: yes (orchestrator re-ran typecheck clean; read result-card.tsx in
       full plus the decrement, focus-transition, and CTA regions raw; agent ran
       vitest lib/signal-scout 223 pass and banned-punctuation scan clean)
     | risk: won subline "Clean decode. The signal is yours." was not specified in
       plan-13 (which gave no won subline); added for layout consistency, trivially
       editable copy. Agent's first completion report was lost to plain text output
       (not SendMessage); recovered by orchestrator ping.
SS-T030 | completed | Remaining states (loading, error, offline, guest limit) + How It Works
     | depends on: SS-T029
     | files: app/games/signal-scout/loading.tsx, app/games/signal-scout/error.tsx,
       app/games/signal-scout/how-it-works.tsx, app/games/signal-scout/page.tsx
     | notes: route loading boundary renders PulseLoader (role="status" default
       mode, label "Loading Signal Scout") inside a main id="main" landmark so the
       skip link keeps a target mid-load (deliberate divergence from the barer root
       app/loading.tsx, matching page.tsx and league-load-error.tsx instead).
       error.tsx follows the Next contract ("use client", { error, reset }),
       league-load-error card pattern, "[signal-scout]" console.error only, and
       never renders error.message (information disclosure rule). How It Works:
       server component, native details/summary disclosure (group-open chevron
       rotation, syntax precedent in the FAAB and OTC settings managers), sr-only
       h2 + h3 subsections, every number (starting score, tier costs, max wrong
       guesses, guest limit) fed from live settings props, nothing hardcoded.
       State-coverage sweep confirmed all six state families reachable with
       file:line evidence (loading, error, empty, disabled-with-reason,
       unavailable, guest limit); no gaps found.
     | verified: yes (orchestrator re-ran typecheck clean and read all three new
       files; agent ran vitest lib/signal-scout 223 pass and banned-punctuation
       scan clean, and verified the Next.js boundary conventions)
SS-T031 | completed | Accessibility pass (live regions, focus management, reduced motion, NVDA)
     | depends on: SS-T024..SS-T030
     | files: app/games/signal-scout/status-bar.tsx, app/games/signal-scout/locked-slots.tsx,
       app/games/signal-scout/signal-scout-client.tsx, app/games/signal-scout/clue-grid.tsx,
       components/image-with-fallback.tsx
     | notes: full code-level audit of all 16 in-scope files against plan section 26
       and the CLAUDE.md accessibility + mobile rules. Four violations found and
       fixed: (1) status bar Panel defaulted to h2 breaking the outline; now
       headingLevel 3 (h1 > h2 sr-only > h3 > h4, no skips in any phase);
       (2) skip button consequence line was adjacent-only; now linked via
       aria-describedby; (3) locked-slot aria-label dropped the visible
       "Tier exhausted"/"No buys left" reason (container aria-label suppresses
       child text on most AT); reason now appended to the label; (4) SHARED
       component fix: image-with-fallback.tsx fallback branch rendered role="img"
       with no name when alt="" (phantom unlabeled graphic, hit by combobox
       results without a sleeperId); empty alt now renders fully aria-hidden with
       no role, orchestrator-reviewed as backward compatible and matching the
       component's own decorative-alt contract (site-wide improvement).
       Verified-no-violation areas documented with evidence in the audit report:
       single polite live region, alert strips mount-on-error only, dialog focus
       trap/restore/initial-Cancel, purchase and completion focus contracts,
       color-never-alone across pips/chips/warnings/markers, reduced-motion
       fallbacks (scanline, PulseLoader, chevron), combobox keyboard edge cases
       traced (all-ruled-out and ruled-out-head), zero data-hiding responsive
       utilities, 44px targets everywhere, no timestamp rendering in scope.
       Orchestrator follow-up fix: newest-clue ring/glow un-gated from
       motion-safe (static highlight, not motion; reduced-motion users keep the
       indicator). Kept as-is by decision: dialog accessible name "Confirm
       signal burnout" vs visible h3 "Burn out your signal?" (plan-26 specifies
       the accessible name verbatim; not a violation).
     | verified: yes (orchestrator re-ran typecheck clean and the FULL suite:
       666 tests across 51 files pass; reviewed the shared-component diff in
       full and spot-checked the three scoped fixes; agent ran per-file
       banned-punctuation scans clean)

SS-T049 | completed | Phase 4 closing-review fixes (from the implementation review's
       PASS WITH NOTES findings; security review passed with zero code findings)
     | files: app/games/signal-scout/page.tsx, app/games/signal-scout/signal-scout-client.tsx,
       app/games/signal-scout/guess-combobox.tsx, app/games/signal-scout/result-card.tsx,
       lib/signal-scout/route-helpers.ts, app/api/games/signal-scout/leaderboards/route.ts
       + route.test.ts
     | notes: (1) hardcoded "costs 100 points" in the combobox help text replaced by a
       wrongGuessPenalty prop chain from live settings (same cosmetic-drift caveat as
       startingScore, commented); (2) handlePurchaseHint now closes the burn dialog on
       every failure branch except burn_confirmation_required, fixing the stale
       zeroed-values dialog that could sit over the result card after a cross-tab
       completion; (3) result states now announce assertively per plan-26: ResultCard
       mounts an sr-only role="alert" node (headline + player + points when won) and
       the polite completion announce() calls were removed to avoid double reads
       (wrong-guess and hint-reveal announcements stay polite); dead
       COMPLETED_HEADLINES map removed. ALSO in this batch, found by the production
       build (never run in Phase 3): scoutFallbackLabel moved from the leaderboards
       route file to lib/signal-scout/route-helpers.ts because Next route modules may
       only export handlers/config (the named export failed next build's route-type
       check while tsc --noEmit stayed green); route + test import from the new home.
       Review nits accepted without change: page.tsx findActiveRoundId-to-getRound
       completion race (narrow, lossless, lands on idle); burned-banner copy merges
       plan-13 and plan-26 wording. Security review informational: confirm
       SIGNAL_SCOUT_IP_SALT is set in production (Phase 8 launch checklist).
     | verified: yes (typecheck clean, full suite 666 tests across 51 files pass,
       unicode-escape punctuation grep clean on app/games/signal-scout and
       lib/signal-scout; production build result recorded in the phase close block)

SS-T048 | completed | Reserve the games top-level route segment (discovered at Phase 4
       close: the prebuild reserved-route guard fails the production build for any
       top-level app/ folder missing from RESERVED_ROUTE_SEGMENTS and
       signal_reserved_handles; app/games/ is new)
     | files: lib/signal/reserved-routes.ts,
       supabase/migrations/0132_signal_reserve_games_segment.sql
     | notes: "games" added to RESERVED_ROUTE_SEGMENTS (alphabetical position) and
       seeded into signal_reserved_handles via migration 0132 (0119 template,
       data-only INSERT with on conflict do nothing; no DDL, no RLS changes, no
       types regen needed). Applied via MCP by the orchestrator.
     | verified: yes (live SELECT confirms the games row exists; production build
       re-run after the fix, see Phase 4 close block)

PHASE 4 CLOSED 2026-07-10. Orchestrated by Fable with Sonnet implementation
subagents; the orchestrator read and re-verified every slice before marking it.
Implementation review: PASS WITH NOTES; all three should-fix findings resolved
same-day in SS-T049 (settings-driven penalty copy, burn-dialog close on failure,
role="alert" result announcements) and two nits accepted with rationale.
Accessibility: the SS-T031 audit-and-fix pass (4 fixes incl. one shared-component
improvement) serves as the phase accessibility review; heading outline, live
regions, focus contracts, color-never-alone, reduced motion, keyboard edge cases,
44px targets, and no-data-hidden-at-any-breakpoint all verified with file:line
evidence. Security review: PASS, zero code findings; anti-cheat invariant
confirmed structural (DTO shapes cannot carry target data), all client-suggests/
server-enforces boundaries have server backstops; one informational item for the
Phase 8 launch checklist (set SIGNAL_SCOUT_IP_SALT in production). Final state:
typecheck clean, 666 tests across 51 files pass, production build passes
(the build also surfaced and we fixed two latent issues: the games reserved-route
seed SS-T048 and the Phase 3 route-file export SS-T049). Not in Phase 4 by scope:
leaderboard preview panel (Phase 5, needs SS-T032 identity resolver), /games hub
and nav (Phase 7), NVDA manual pass and e2e runs (Phase 8). All work uncommitted
per owner instruction.

## Phase 5 - Leaderboards and stats
PHASE 5 STARTED 2026-07-10 (owner approval received). Scope decisions locked at start:
plan question 1 decided by owner instruction: the email local-part fallback step is
MASKED on public leaderboards (first two characters plus asterisks), never verbatim.
SS-T035 (optional round history) stays pending per owner instruction (progress.md
marks it optional pending decision; not Phase 5 MVP). SS-T047 untouched. SS-T050
added for the leaderboard preview panel deferred from the Phase 4 close block.

SS-T032 | completed | lib/user-identity.ts public identity resolver + tests; replaced
       every scoutFallbackLabel call site in the leaderboards route (masked email step)
     | files: lib/user-identity.ts, lib/user-identity.test.ts,
       lib/signal-scout/route-helpers.ts,
       app/api/games/signal-scout/leaderboards/route.ts + route.test.ts
     | notes: one shared resolver encoding the My Beacon hierarchy
       (user_metadata.display_name, then first_name + last initial, then email
       local-part, then Scout-XXXX). IdentitySurface "public" masks the email
       step to first two chars + exactly three asterisks (fixed count so the
       mask never leaks length; plan question 1 decided by owner: mask);
       "private" keeps verbatim for future dashboard migration.
       resolveUserIdentities batches one user_preferences query, parallel
       auth.admin.getUserById lookups, and one createSignedUrls call against
       the private user-avatars bucket (1-hour TTL matching the admin page);
       never throws, every requested id gets a Map entry, partial failures
       degrade down the hierarchy with [user-identity] console.error.
       scoutFallbackLabel MOVED from route-helpers.ts to the new lib (zero
       references remain in route-helpers; hashGuestIp keeps createHash).
       Leaderboards route resolves identities once per request AFTER the
       cached board query (signed URLs and names stay per-request fresh while
       the board page stays cached 60s); rows and the your-rank strip keep the
       scout field and gain avatarUrl; defensive identityFor fallback for ids
       missing from the map; raw auth user ids still never serialized.
       route-helpers.test.ts untouched (it never tested scoutFallbackLabel;
       assertions ported to lib/user-identity.test.ts instead).
     | depends on: SS-T023
     | verified: yes (orchestrator read lib/user-identity.ts in full and the
       route integration regions, then re-ran: 44 tests pass across
       lib/user-identity.test.ts (26) and leaderboards route.test.ts (18,
       3 new: display_name wins, masked email never leaks the raw local part,
       avatarUrl on every row); agent ran lib/signal-scout folder 223 pass;
       npm run typecheck clean; punctuation grep clean; repo-wide
       scoutFallbackLabel sweep shows only the new lib + intended call sites)
SS-T033 | completed | Leaderboards page tabs + your-rank strip + pagination
     | depends on: SS-T023, SS-T032
     | files: lib/signal-scout/leaderboards.ts, lib/signal-scout/leaderboards.test.ts,
       app/games/signal-scout/leaderboards/page.tsx, leaderboard-tabs.tsx,
       leaderboard-table.tsx, leaderboard-pager.tsx, retry-card.tsx,
       app/api/games/signal-scout/leaderboards/route.ts
     | notes: board query layer EXTRACTED from the API route into
       lib/signal-scout/leaderboards.ts (identical semantics, now typed rows:
       DailyBoardRow/AllTimeBoardRow/StreakBoardRow; JSON keys unchanged) with
       a composed loadLeaderboardView(admin, board, page, meId, hideAdminUsers)
       shared by route and page. New countBoardRows head-count powers
       totalPages (additive field on the API response); count runs OUTSIDE the
       60s board cache (cheap indexed count, keeps a fresh row's page span
       live). Accepted deviation: hideAdminUsers threaded as a 5th param since
       both callers already load settings for their gates (avoids a redundant
       settings query per request). Page: force-dynamic server component at
       /games/signal-scout/leaderboards; gates mirror the API contract
       (leaderboard master + per-board flags; game_enabled deliberately not
       consulted, matching the route); disabled boards drop their tab and the
       requested board falls back to the first enabled one; require_login
       without a session renders the tab bar plus a sign-in CTA card (both
       CTAs to /login per repo convention); routed tabs clone the league-tabs
       pattern (nav + Link + aria-current, cockpit bar, min-h-11); local pager
       preserves the board param via URLSearchParams (admin Pager drops
       foreign params, documented); your-rank strip reuses the table's
       ScoutCell/RankCell with a visible You pill (never color alone); tables
       are semantic with sr-only captions naming board and page, th scope,
       null percents render "-" plus sr-only "no data"; MOBILE: focusable
       labeled overflow-x-auto region wraps the full table, zero hidden
       columns at any breakpoint; out-of-range pages clamp to totalPages and
       reload once; data-load failures render a client RetryCard
       (router.refresh, league-load-error pattern), no error text rendered.
     | verified: yes (orchestrator read the extracted lib in full plus all 5
       page files and re-ran: 273 tests across 12 files pass including the 18
       pinned route tests and new lib/signal-scout/leaderboards.test.ts;
       npm run typecheck clean; agent punctuation grep clean on all 8 files;
       ImageWithFallback decorative alt="" contract verified against the
       shared component)
SS-T050 | completed | Leaderboard preview panel on the game page (deferred from Phase 4
       close; server-fetched, identity-resolved rows, guest teaser variant)
     | depends on: SS-T032, SS-T033
     | files: lib/signal-scout/leaderboards.ts, lib/signal-scout/leaderboards.test.ts,
       app/games/signal-scout/leaderboard-preview.tsx,
       app/games/signal-scout/page.tsx, app/games/signal-scout/signal-scout-client.tsx
     | notes: loadLeaderboardPreview(admin, hideAdminUsers, meId) returns the
       daily top 5 (PREVIEW_SIZE) by giving queryBoardRows an optional
       pageSize arg (default PAGE_SIZE, so loadLeaderboardView is
       byte-identical); raw rows cached 60s keyed
       (signal-scout-leaderboard-preview, ET date), identities incl. meId
       resolved per-request OUTSIDE the cache; never throws (preview is
       non-critical, errors swallowed with [signal-scout] log, returns []).
       Panel: section + h3 (aria-labelledby), ordered list, plain-text ranks
       (top-3 badge keeps the visible number), decorative alt="" avatars via
       ImageWithFallback, visible You pill + tint (never color alone), points
       with visible pts label, min-h-11 links. Guests with require_login on
       get a teaser variant (copy + Create a free account -> /login, repo has
       no /signup route); everyone else gets rows + View all leaderboards ->
       /games/signal-scout/leaderboards. Renders in idle and completed phases
       only (not active/guest_limit/offline). Accepted deviations, orchestrator
       decided: preview has no routed tabs (plan-21's tabs live on the
       dedicated leaderboards page the panel links to); completed phase
       suppresses the preview for guests at 0 rounds left so the existing
       signup wall never stacks with a second Create-a-free-account CTA
       (commented in code). Both flags were raised by the subagent and fixed
       same-task: meId threading (You pill live) and the double-CTA
       suppression.
     | verified: yes (orchestrator read leaderboard-preview.tsx in full, the
       loader, and both client integration regions plus the page.tsx wiring
       raw (grep line-render artifact ruled out twice); re-ran 277 tests
       across 12 files pass (+4 preview loader tests incl. the isYou case);
       npm run typecheck clean; agent punctuation grep clean on all files)
SS-T034 | completed | My stats panel + guest signup flow polish
     | depends on: SS-T032
     | files: app/games/signal-scout/my-stats-panel.tsx,
       app/games/signal-scout/page.tsx, app/games/signal-scout/signal-scout-client.tsx,
       app/games/signal-scout/status-bar.tsx, app/games/signal-scout/how-it-works.tsx
     | notes: My Scout Record panel (idle phase only, logged-in users with a
       stats row; first completed round seeds the row so no empty-state panel).
       page.tsx widened the EXISTING signal_scout_user_stats select (still one
       query) to feed a new MyScoutStats prop (camelCase mirror of the
       /me/stats route shape minus timestamps/moderation fields). Panel:
       section + h3 aria-labelledby matching the preview panel shell, Target
       icon (Radar and Zap already taken by adjacent panels), StatReadout dl
       tiles (Total points, Rounds played, Wins, Best Signal Streak, Best
       Daily Scout Streak) plus a custom WinRateTile (one decimal + %, "-"
       with sr-only "no data" at zero rounds; win rate = rounds_won /
       rounds_played, solved-late in the denominator only per plan-8), muted
       solved-late/failed/skipped breakdown line, 2-col mobile to 3-col grid
       with nothing hidden at any breakpoint, no timestamps rendered.
       Accepted judgment call: win-rate math inlined instead of importing
       round1 from lib/signal-scout/leaderboards.ts (that module pulls
       next/cache into what is rendered from a use-client tree). Guest copy
       polish: two streaks-only strings updated to sell streaks AND
       leaderboards (status-bar guest footnote; how-it-works Guests section);
       guest_limit/completed walls and the leaderboards SignInCard already
       mentioned both and were left alone; all CTAs still /login.
     | verified: yes (orchestrator read my-stats-panel.tsx in full plus the
       page query, prop, and idle render regions; re-ran 259 tests across 11
       files pass; npm run typecheck clean; agent punctuation grep clean on
       all 5 files; database.types.ts already carried all widened columns,
       no regen needed)
SS-T051 | completed | Phase 5 security-review fixes: (1) preview rows leaked to
       gated guests via the RSC payload (Medium), (2) leaderboards API
       amplification: uncached identity fan-out with no rate limit (Medium),
       (3) informational comment on applyExclusion's uuid-FK invariant
     | depends on: SS-T050
     | files: app/games/signal-scout/page.tsx, lib/signal-scout/leaderboards.ts,
       app/api/games/signal-scout/leaderboards/route.ts + route.test.ts,
       lib/signal-scout/leaderboards.test.ts
     | notes: (1) gated guests (require_login on, no session) now get
       leaderboardPreview = [] WITHOUT calling the loader: client-component
       props serialize into the RSC flight payload regardless of what renders,
       so row data must never reach the prop; the teaser branch ignores rows
       so the panel survives (commented in page.tsx). (2a) API route claims
       via claimAction after the gates/session resolve (401 never burns a
       claim), key user:<id> else ip:<salted hash>, action "leaderboards",
       server-constant 2s window, 429 rate_limited on denial; no cookie mint
       on GET (mirrors the search route); nothing client-side calls this
       route today so the window only touches scripted callers. (2b) new
       exported cachedResolveIdentities in lib/signal-scout/leaderboards.ts:
       sorts ids (order-insensitive cache key via hashed args), unstable_cache
       60s, inner function returns [...entries] because a Map does not survive
       unstable_cache JSON serialization, wrapper rebuilds the Map; both
       loadLeaderboardView and loadLeaderboardPreview use it; stale
       per-request-fresh comments rewritten (public display data, 1h signed
       URL TTL >> 60s cache, kills the GoTrue/storage fan-out). (3)
       applyExclusion doc comment now states the uuid-FK invariant and warns
       against reuse with less-trusted id sources. +8 tests (4 route: 429
       path, free 401, user: key, ip: key; 4 lib: Map rebuild, unknown-id
       fallback, sorted cache args, JSON round-trip of the cached shape).
     | verified: yes (orchestrator read all three fix sites raw and re-ran:
       full suite 713 tests across 53 files pass, npm run typecheck clean,
       production build passes end to end; agent punctuation grep clean on
       all 5 files)
SS-T035 | pending | Optional: logged-in round history view (pending decision, plan Q5;
       explicitly NOT in Phase 5 MVP per owner instruction 2026-07-10)

PHASE 5 CLOSED 2026-07-10. Orchestrated by Fable with Sonnet implementation
subagents; the orchestrator read and re-verified every slice before marking it.
Tasks: SS-T032 (identity resolver), SS-T033 (leaderboards page), SS-T050
(preview panel), SS-T034 (my stats + guest copy), SS-T051 (security fixes).
Implementation review: PASS, zero findings (board orderings, identity
hierarchy, your-rank math, cache scoping, refactor fidelity, and test quality
all verified with file:line evidence; one informational carried below).
Accessibility review: PASS WITH NOTES, zero must-fix; heading outlines,
no-data-hidden-at-any-breakpoint, color-never-alone, and keyboard reachability
of the scrollable tables all confirmed; three nits accepted as pre-existing
house patterns replicated for consistency (tab sm:min-h-0 from league-tabs,
aria-current on the pager page counter from admin Pager, no scope="row").
Security review: PASS WITH NOTES; both Medium findings FIXED same-day in
SS-T051 (RSC-payload preview leak to gated guests; leaderboards API identity
fan-out amplification) and the informational applyExclusion comment added.
Carried forward, no action needed now:
  1. (impl review, informational) computeYourRank shows a hidden/admin user
     their own your-rank strip even though they are excluded from the board
     listing; pre-existing SS-T023 behavior, own-data only, no leak.
  2. (security, pre-existing) requireFfBeaconHeader is not an auth boundary
     (static public header value); real limits are the claim RPCs.
  3. PHASE 8 launch checklist additions: SIGNAL_SCOUT_IP_SALT in Vercel
     (from Phase 4) and confirm Vercel overwrites client-supplied
     x-forwarded-for (from Phase 3) both still open.
Final state: typecheck clean, full suite 713 tests across 53 files pass,
production build passes end to end (/games/signal-scout/leaderboards ships).
No migrations in Phase 5 (next is still 0133); no commits per owner
instruction. Not in Phase 5 by scope: SS-T035 (optional round history,
pending owner decision), SS-T047 (snap-share/red-zone clues, pending owner
prioritization), Phase 6 admin area not started.

## Phase 6 - Admin area (/admin/signal-scout)
PHASE 6 STARTED 2026-07-10 (owner approval received in session). Scope: SS-T036 through
SS-T040 only; no Phase 7 work, no SS-T035, no SS-T047 without explicit owner approval.
Orchestrated by Fable with Sonnet implementation subagents. Pattern anchors confirmed
before start: requireAdmin (lib/admin-auth.ts, per-page defense in depth with own path),
createAdminClient (lib/supabase/server.ts), NAV_ITEMS entry shape (components/admin-nav.tsx),
OTC settings manager as the reset-preserves-enabled template
(app/admin/on-the-clock/actions.ts resetOnTheClockSettings), Pager
(components/admin/pager.tsx), DraftSnapshotsPanel table conventions, hidePost/unhidePost
moderation action shape (app/admin/signal/actions.ts), resolveUserIdentities batched
avatar signing (lib/user-identity.ts). No migrations expected this phase (next is 0133).

SS-T036 | completed | Overview page (stat cards, hardest/easiest/most guessed/most skipped,
       clue usage, recent rounds + guesses)
     | files: app/admin/signal-scout/page.tsx, app/admin/signal-scout/insights.ts,
       app/admin/signal-scout/player-insight-tables.tsx,
       app/admin/signal-scout/recent-rounds-table.tsx,
       app/admin/signal-scout/recent-guesses-table.tsx,
       components/admin/signal-scout-subnav.tsx, components/admin-nav.tsx
     | notes: requireAdmin("/admin/signal-scout") in-page (defense in depth beside the
       layout gate), createAdminClient reads only. Stat cards: 8 head counts (total,
       today via currentEasternGameDate, per-status, burned) plus avg winning score and
       avg hints from an explicit 1000-row completed-rounds window (visible caption
       states the window size; window reused for hardest/easiest/most-skipped with a
       min-5-rounds gate). Most guessed aggregates the latest 5000 guesses. Clue usage:
       5 per-tier head counts, labels imported from the game's TIER_DISPLAY_NAMES
       (clue-grid.tsx verified to have no "use client" directive, so the server import
       is safe). Recent rounds + guesses: self-contained async server components on the
       DraftSnapshotsPanel conventions, Pager paramName roundsPage/guessesPage with
       hash anchors, page clamped to totalPages, identities via batched
       resolveUserIdentities(admin, ids, "private"), guests render "Guest <uuid8>" in
       mono, timestamps formatRelative + formatEastern title, status badges pair tone
       with text (never color-only), three-state error/empty/loaded everywhere with
       [signal-scout-admin] console.error and generic user-facing messages. NAV_ITEMS
       gained a Radar-icon Signal Scout entry after On The Clock. Subnav created with
       all five section tabs (integrity/players/users/settings routes land in
       SS-T037..040 this phase). Orchestrator fix on review: subnav flex row gained
       overflow-x-auto (five tabs can exceed a 375px viewport; the 3-tab
       signal-check original never hit this).
     | verified: yes (agent ran npm run typecheck clean and vitest lib/signal-scout
       237 pass; unicode-escape punctuation grep zero matches on all new/edited
       files; orchestrator read page.tsx, insights.ts, both recent tables, the
       subnav, and the admin-nav diff in full and verified gating, query windows,
       Pager wiring, timestamp handling, and ASCII punctuation)
     | risk: house Pager drops foreign query params, so paging one recent table
       resets the other to page 1 (pre-existing admin Pager behavior, accepted);
       admin overview shows target players of ACTIVE rounds by design, admin-gated
       only, never to ship on any public surface
SS-T037 | completed | Integrity panel (burnout abusers, rapid guesses, search volume)
     | depends on: SS-T009
     | files: app/admin/signal-scout/integrity/page.tsx
     | notes: read-only surfacing page, zero mutations, links to the Users tab for the
       hide action. Three sections: (1) burnout and late solves from
       signal_scout_user_stats via one .or(rounds_burned.gte.3,rounds_solved_late.gte.3)
       filter, burn rate one-decimal percent with sr-only "no data" at 0 played;
       (2) rapid guesses: latest 2000 guesses grouped per round, only strictly
       consecutive guess numbers (n, n+1) compared so the fixed window can never
       fabricate a false pair, deltas under 2000ms, 20 newest shown, identity
       attributed via one rounds .in() lookup; (3) search volume from
       signal_scout_activity_counters eq action "search" (exact string verified
       against search/route.ts claimAction call), last 7 ET days via a local
       UTC-noon date helper mirroring streaks.ts math, identity_key rendering handles
       user:/guest:/ip: prefixes (resolved name, Guest <uuid8>, IP <hash8>).
       All user ids from all three sections resolve through ONE
       resolveUserIdentities(admin, ids, "private") call. Delta column renders raw
       milliseconds by design (duration, not a timestamp; lib/datetime formatDuration
       would flip to seconds above 1000ms). Orchestrator fix on review: per-section
       query failures now render a distinct ErrorBox instead of falling through to
       the empty-state copy (a failed query previously read as "no findings", which
       would misreport an outage as a clean integrity sweep).
     | verified: yes (agent ran npm run typecheck clean, vitest lib/signal-scout 237
       pass, punctuation scan via explicit codepoints zero matches; orchestrator read
       the full page, verified action strings and identity handling, applied the
       error-state fix, and re-ran npm run typecheck clean after it)
SS-T038 | completed | Players page (eligibility checks, hide/unhide with note)
     | files: app/admin/signal-scout/players/page.tsx,
       app/admin/signal-scout/players/player-detail-panel.tsx,
       app/admin/signal-scout/players/player-moderation.tsx,
       app/admin/signal-scout/actions.ts, app/admin/signal-scout/admin-constants.ts,
       components/admin/pager.tsx
     | notes: summary table lists loadEligiblePool output PLUS orphaned hidden
       players whose position left the configured pool (override rows diffed
       against the pool id set; only the leftover set is re-fetched), with the four
       cheap checks as Pass/Fail chips (coverage column deliberately omitted at
       this tier since clueCoverage null would render a lying Fail; coverage is
       computed only in the detail view). In-memory name search (GET form, q param)
       + Pager (playersPage) at 25/page; per-page target counts via one scoped
       .in() query. Detail view (?player=<uuid>, zod-validated, friendly not-found)
       runs the round-engine lazy-verify seam exactly (loadStatsBundle,
       assembleClueFacts, generateClueCandidates, applyDisabledKeys,
       computeClueCoverage) for the ONE inspected player and renders all five
       checks with detail sentences plus starter/per-tier coverage counts and the
       hide state with note, updated_by (resolved identity) and Eastern timestamp.
       Server actions (first in the area): hideSignalScoutPlayer (uuid zod, note
       required, trimmed, 300 cap, upsert with updated_by/at) and
       unhideSignalScoutPlayer (DELETES the override row; row presence is the
       signal per the 0130 design note); both requireAdmin first and revalidate
       players + overview paths. Client moderation row: inline required note
       textarea for hide, window.confirm for unhide, useTransition,
       aria-live="polite" status, router.refresh on success, min-h-11 targets.
       Accepted deviation: components/admin/pager.tsx gained an optional
       backward-compatible extraParams prop so pagination preserves the search
       term (first admin page combining search + Pager; old callers byte-identical).
       Orchestrator fixes on review: (1) BUILD BREAKER: ADMIN_NOTE_MAX was exported
       from the "use server" actions file (only async function exports are legal at
       runtime; tsc cannot catch it, next build would fail exactly like the Phase 4
       route-export finding); moved to new app/admin/signal-scout/admin-constants.ts
       and both import sites updated. (2) CheckChip detail sentences were title-only
       (screen readers skip title); added an sr-only span with the detail text.
     | verified: yes (agent ran npm run typecheck clean, vitest lib/signal-scout
       237 pass, punctuation scan clean on all files; orchestrator read actions.ts,
       both page components, the moderation client, and the pager diff in full,
       applied the two fixes above, and re-ran npm run typecheck clean)
     | risk: pager extraParams is now available to all admin pages; house Pager
       still drops params not passed explicitly (unchanged default behavior)
SS-T039 | completed | Users page (activity, hide/unhide from leaderboards)
     | files: app/admin/signal-scout/users/page.tsx,
       app/admin/signal-scout/users/user-detail-panel.tsx,
       app/admin/signal-scout/users/user-moderation.tsx,
       app/admin/signal-scout/actions.ts
     | notes: paginated activity table (25/page, total_points desc with a
       user_id tiebreak for stable paging), avatar + resolved name via one
       batched resolveUserIdentities("private") per page, win rate with the
       "-" + sr-only no-data convention, last_played_date rendered as-is (ET
       calendar date, never passed through a timestamp formatter), hidden
       state with 40-char reason excerpt. Drill-in (?user=<uuid>, zod,
       friendly not-found) shows every aggregate column in a dl grid, win and
       burn rates, moderation quartet with hidden_by resolved in a scoped
       [userId, hidden_by] identity call (selected user may not be on the
       loaded page; mirrors the players detail tradeoff, documented), and the
       10 most recent rounds with target names and status badges. Actions
       appended to actions.ts: hideSignalScoutUser (reason required, 300 cap,
       sets the full hidden quartet with admin id + timestamp) and
       unhideSignalScoutUser (nulls the quartet, house unhidePost shape);
       both are single-round-trip UPDATEs chained with .select("user_id") so
       a missing stats row returns "That user has no Signal Scout record."
       instead of silently succeeding; both revalidate the admin page and
       /games/signal-scout/leaderboards with the accepted 60s public cache
       lag documented in a comment. No search form by orchestrator scope
       decision (user_stats has no name column; per-page identity resolution
       makes honest name search impossible without a schema change);
       documented in code plus a visible tip line pointing at leaderboards
       and Integrity. Client-prop surface kept minimal (userId, displayName,
       isHidden only).
     | verified: yes (agent ran npm run typecheck clean, vitest
       lib/signal-scout 237 pass, punctuation scan zero matches on all 4
       files; orchestrator read the new actions in full, the page, the
       detail panel, and the moderation client import surface, and confirmed
       zero-row handling, anti-leak props, timestamp conventions, and the
       ADMIN_NOTE_MAX import from admin-constants)
SS-T040 | completed | Settings manager + server actions (save/reset preserving game_enabled)
     | depends on: SS-T010
     | files: app/admin/signal-scout/settings/page.tsx,
       app/admin/signal-scout/settings/signal-scout-settings-manager.tsx,
       app/admin/signal-scout/actions.ts, lib/signal-scout/settings.ts,
       lib/signal-scout/settings.test.ts
     | notes: client manager cloned from the OTC template (NumberInput
       text-buffer, Field, Toggle, SectionCard, CollapsibleSection, typed
       nested patch helpers, useTransition, aria-live status, sticky footer
       Save / Reset form / Reset-and-save with window.confirm). Nine sections:
       game_enabled, guests (limit hint documents 0 fails closed), scoring
       (snapshot-at-round-start hint), clue limits, disabled clue types (37
       CLUE_DEFINITIONS checkboxes grouped by tier in a fieldset+legend,
       checked = disabled), player pool (last-position checkbox disabled with
       an explanatory hint so the pool can never be emptied client-side),
       leaderboards (6 toggles), reveal, future flags (no-effect-today hints),
       plus a maintenance collapsible with formatEastern last-saved and a
       read-only settings dump. Deferred SS-T010 clamp added:
       clampSignalScoutSettings in lib/signal-scout/settings.ts (OTC
       clampOnTheClockSettings shape; ranges: guest limit 0-20, starting
       score 100-10000, costs/penalty 0-5000, max wrong 1-10, starter count
       1-6, tier limits 0-10; positions intersected/deduped with empty
       restored to defaults since an empty pool bricks round starts;
       disabled_clue_keys filtered to the catalog, import direction verified
       cycle-free: clues.ts never imports from settings.ts) + 8 tests.
       Actions appended: saveSignalScoutSettings (requireAdmin, clamp then
       validate then upsert with updated_by/at) and resetSignalScoutSettings
       (reads current row, keepEnabled = parsed game_enabled else false,
       defaults spread with game_enabled preserved, returns settings for
       client state sync); both revalidate the settings page, /games/signal-scout,
       and /games/signal-scout/leaderboards. Toggle deviations accepted:
       ReactNode label (tier name in muted span), disabled prop (pool guard),
       min-h-11 wrapper (44px targets; superset of OTC). Orchestrator fix on
       review: guest-limit NumberInput now carries describedBy wiring to its
       fails-closed hint (Field renders hints but does not auto-associate).
     | verified: yes (orchestrator re-ran: npx vitest run lib/signal-scout
       10 files 245 tests all pass (+8 clamp tests over the 237 baseline;
       the agent report's 198/+47 arithmetic was wrong, actual counts
       verified directly), npm run typecheck clean after the describedBy fix;
       orchestrator read the clamp, both actions, the page, and the full
       manager; agent punctuation scan zero matches on all 5 files)

PHASE 6 CLOSED 2026-07-10. Orchestrated by Fable with Sonnet implementation
subagents; the orchestrator read and re-verified every slice before marking it.
Tasks: SS-T036 (overview + nav + subnav), SS-T037 (integrity panel), SS-T038
(players + first server actions), SS-T039 (users + leaderboard moderation),
SS-T040 (settings manager + clamp). Implementation review: PASS WITH NOTES;
plan-17/18 coverage confirmed complete item by item; the one should-fix
(the overview's 13 head-count queries logged nothing on failure, contradicting
the SS-T036 note) fixed same-day by the orchestrator (labeled console.error on
all 8 stat counts and 5 clue-tier counts); nits accepted with rationale
(intentional STATUS_LABEL/ErrorBox duplication, twin 40-char excerpt
constants). Accessibility review: PASS WITH NOTES; both moderate findings
fixed same-day by the orchestrator: (1) the Hide disclosure in both moderation
controls is now a persistent toggle with aria-expanded + aria-controls (also
fixing the focus loss when the button was swapped out of the DOM), (2) full
round ids now carry sr-only text beside the aria-hidden 8-char prefix
(recent-guesses table + integrity rapid-guesses table); the low finding also
taken (CollapsibleSection titles are now real h2 headings inside summary for
heading-list navigation); informational items accepted (pre-existing pager
aria-current nit, title-only CheckChip detail for sighted keyboard users with
the load-bearing Pass/Fail always visible); no data hidden at any breakpoint
confirmed by grep; full heading outlines traced for all five pages. Security
review: PASS WITH NOTES, zero critical/high/medium; authz verified on every
page (requireAdmin with own path) and every action (requireAdmin first,
redirect-throws before any DB work); import-graph grep confirms no Phase 6
module is referenced from app/games/** or app/api/games/** (the anti-cheat
boundary holds; admin-only target visibility never reaches public surfaces);
uuid zod validation everywhere; pager extraParams injection-safe via
URLSearchParams; audit fields verified on all four moderation actions; no new
deps, no migrations after 0132; the one low finding (raw supabase
error.message in the two settings actions) fixed same-day by the orchestrator
(generic messages + [signal-scout-admin] console.error, now consistent with
the moderation actions in the same file). Final state: typecheck clean, full
suite 721 tests across 53 files pass, production build passes end to end with
all five admin routes shipping (/admin/signal-scout, /integrity, /players,
/users, /settings), banned-punctuation scan clean across all 21 Phase 6 files.
No commits per owner instruction. Not in Phase 6 by scope: Phase 7 games hub
and nav (not started, awaiting owner approval), SS-T035 and SS-T047 (still
pending owner decisions), NVDA manual pass and e2e runs (Phase 8).

## Phase 7 - Games hub and navigation
PHASE 7 STARTED 2026-07-11 (owner approval received in session). Scope: SS-T041 through
SS-T043 only (plan sections 22-23); no Phase 8 work, no SS-T035, no SS-T047 without
explicit owner approval. Orchestrated by Fable with Sonnet implementation subagents.
Approved copy locked at start: name Signal Scout; tagline "Decode the profile. Find the
player."; description "A mystery player. A handful of clues. Decode the scouting profile
and name the player before the signal burns out."; CTA "Start scouting"; status pill
"New". Dropdown overview label for Games: "All Games". Note: next.config.ts has
typedRoutes: false, so the plan-22 "/games ships before the nav entry" ordering is a
soft constraint; honored anyway (SS-T041 landed first).

SS-T041 | completed | /games hub page (ToolCard grid + placeholder card)
     | files: app/games/page.tsx
     | notes: static server component, no data fetching. Hero on the tools-page
       pattern (beacon hairline, ambient glow, eyebrow "Fantasy football games",
       h1 "Play the data you already trust." with gradient span + collapsing
       aria-label). Games grid: typed GAMES const array (future games append an
       entry), ul role="list" md:grid-cols-2, Signal Scout card on the homepage
       ToolCard pattern (Radar icon in beacon square, New pill using the exact
       SourceCard Default pill classes, approved tagline/description/CTA, links
       /games/signal-scout) plus a NON-interactive ComingSoonCard (dashed border,
       muted Sparkles icon square, "More games are in the works." copy; not a
       link, nothing focusable). Heading order h1 > h2 > h3, no skips.
       Orchestrator copy fix: metadata described Signal Scout as a "daily"
       guessing game (daily-challenge is a plan-24 future mode); "daily" removed.
     | verified: yes (agent ran npm run typecheck clean + banned-punctuation scan
       zero matches; orchestrator read the full file, verified pattern fidelity
       against app/page.tsx ToolCard and app/tools/page.tsx Hero, applied the
       metadata fix, and re-ran npm run typecheck clean; phase-close reviews
       pending)
SS-T042 | completed | Nav integration (GAMES_NAV, PRIMARY_NAV, footer column, nav-dropdown
       overviewLabel parameterization)
     | depends on: SS-T041
     | files: lib/site.ts, components/nav-dropdown.tsx, components/site-header.tsx,
       components/site-footer.tsx
     | notes: GAMES_NAV (Signal Scout entry, tagline as description) added after
       TOOLS_NAV; PRIMARY_NAV gains Games immediately after Tools with
       overviewLabel "All Games" and overviewDescription "See every game on one
       page"; NavItem type gains optional overviewLabel/overviewDescription;
       NavDropdown parameterized with those two props DEFAULTED to the previous
       hardcoded strings so the Tools dropdown renders byte-identically;
       site-header passes both through (undefined for Tools, so defaults apply).
       SEARCHABLE_TOOLS gains Signal Scout + Games entries after FAAB Calculator
       (tools-then-content ordering preserved). FOOTER_COLUMNS gains a Games
       column (All Games, Signal Scout) between Tools and Learn; footer grid
       updated from md:grid-cols-[1.6fr_1fr_1fr_1fr] to
       sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr_1fr] to seat About + 4 nav
       columns (mobile still stacks; nothing hidden). Mobile menu confirmed to
       render Games + child automatically from PRIMARY_NAV with min-h-11 targets
       (read-only check, unmodified). Accepted deviation: two pre-existing
       em-dash comment violations fixed in-scope (lib/site.ts SOCIAL_LINKS doc
       comment, site-header.tsx loadHeaderData comment); comment text only, zero
       behavior change, per the absolute ASCII punctuation rule.
     | verified: yes (agent: per-file typecheck clean, banned-punctuation scan
       zero matches on all four files, repo grep shows "All tools" overview
       strings exist only in nav-dropdown defaults; orchestrator reviewed the
       full git diff of all four files and re-ran npm run typecheck clean on the
       combined tree with SS-T041/T043 landed; the agent's observed
       app/page.tsx GamesSection error was the SS-T043 edit mid-flight, since
       resolved; phase-close reviews pending)
SS-T043 | completed | Homepage GamesSection with Signal Scout card + New pill
     | depends on: SS-T041
     | files: app/page.tsx
     | notes: GamesSection inserted between ToolsSection and SourcesFormatsSection,
       mirroring ToolsSection's header structure (eyebrow "Free games, real data",
       h2 "Decode the profile. Find the player.", "See all games" link to /games with
       the exact See-all-tools classes). Card grid mt-12 md:grid-cols-2 rendering
       FEATURED_GAMES (typed const array of one; future games append). GameCard is a
       dedicated component byte-identical to ToolCard's classes except the top-row
       index number is replaced by the New status pill (exact SourceCard Default pill
       classes). Approved copy verbatim; Radar icon already imported; section given
       the plain (no glow) treatment so page rhythm alternates. No data fetching, no
       metadata changes, no changes to existing sections.
     | verified: yes (agent ran npm run typecheck clean + banned-punctuation scan
       zero matches on app/page.tsx; orchestrator read the full new region and the
       render position and verified class fidelity against ToolCard and the
       SourceCard pill; phase-close reviews pending)

PHASE 7 CLOSED 2026-07-11. Orchestrated by Fable with Sonnet implementation
subagents; the orchestrator read and re-verified every slice before marking it.
Tasks: SS-T041 (/games hub), SS-T042 (nav integration), SS-T043 (homepage
GamesSection). Implementation review: PASS WITH NOTES; the one must-fix
(hub Game type's href was the "/games/signal-scout" string literal, so a
second game card could not typecheck, contradicting plan-22's
"trivially accepts future game cards") fixed same-day by the orchestrator
(href widened to string, matching the homepage FeaturedGame), plus both
should-fixes taken (hub metadata title now "Fantasy Football Games" per the
Fantasy Football X hub convention; hub naming aligned to type Game +
component GameCard, removing the GameCard-type vs GameCardItem-component
inconsistency against the homepage). Accepted with rationale: hub hero has
no Discord/rankings CTA row (the game cards ARE the page's CTAs; plan-22
specs a card-grid page, not a clone of the tools marketing page); hub card
renders the approved tagline line that the homepage card omits (the
homepage uses the tagline as its section h2 instead); GamesSection has no
ambient glow (deliberate page rhythm, back-to-back glowing sections
avoided). Plan-22/23 checklist confirmed item-by-item with file:line
evidence, including dropdown order Games > All Games > Signal Scout and
byte-identical New pill classes. Accessibility review: PASS WITH NOTES,
zero must-fix; both notes taken by the orchestrator (footer grid gained an
md:grid-cols-3 step so the 768-1023px range is not stuck at 2 columns;
redundant aria-labelledby dropped from the hub games ul which duplicated
the section's label and double-announced). Accepted as pre-existing house
patterns: footer text links below 44px (all columns, predates the diff);
whole-card single-link accessible-name length (matches shipped
ToolCard/ArticleCard). Verified clean: no data hidden at any breakpoint
(zero responsive-hiding utilities in the diff), NavDropdown keyboard model
and ARIA untouched by parameterization, Tools dropdown renders
byte-identically via defaults, mobile menu inherits Games generically with
min-h-11 targets, ComingSoonCard non-focusable, motion-reduce guards on
both cards, no timestamps rendered, no lib/signal-scout or admin imports on
any new public surface. Final state: typecheck clean, full suite 721 tests
across 53 files pass, production build passes end to end (/games ships;
reserved-route guard green from SS-T048), banned-punctuation scan clean on
all six Phase 7 files. No migrations (next is still 0133); no commits per
owner instruction (Phases 4-7 all uncommitted). Not in Phase 7 by scope:
SS-T035 and SS-T047 (still pending owner decisions), Phase 8 verification
and launch (not started, awaiting owner approval).

## Phase 8 - Verification and launch
PHASE 8 STARTED 2026-07-11 (owner approval received in session). Scope: SS-T044 through
SS-T046 only; SS-T035 and SS-T047 remain untouched pending owner decisions. Session rules:
no commits, no pushes, no Chrome browser testing, do not flip game_enabled to live without
cleared blockers and explicit plan support (stop and ask if uncertain). Orchestrated by
Fable with Sonnet verification subagents.

Orchestrator pre-flight findings (2026-07-11, before any task work):
  1. LAUNCH BLOCKER FOUND: signal_scout_settings has NO row in the live DB, and
     DEFAULT_SIGNAL_SCOUT_SETTINGS.game_enabled is true (loader falls back to defaults
     on missing row). Deploying today would put the game live immediately with no gate.
     The launch-behind-game_enabled posture requires seeding the settings row with
     game_enabled false BEFORE any deploy. To be resolved and verified in SS-T046.
  2. SIGNAL_SCOUT_IP_SALT is absent from local .env.local (documented in
     .env.local.example only); production (Vercel) status unverified so far. Carried
     into the SS-T046 launch checklist.
  3. All seven signal_scout_* tables are empty (clean slate); with no settings row the
     game resolves enabled locally, so e2e can run against a local dev server without
     any state flips. E2e test rows must be cleaned up after SS-T044.

Phase 8 closing security review (Sonnet subagent, 2026-07-11): PASS, zero
critical/high/medium findings across all 12 audited areas, with live-DB evidence:
RLS relrowsecurity true on all 8 signal_scout tables with exactly the expected
policies (service_role_all everywhere; select_own only on user_stats and
daily_scores); both SECURITY DEFINER RPCs execute-locked to postgres +
service_role; anti-cheat DTO invariant structurally confirmed (type-only client
imports, no pre-completion target data on any path); leaderboard privacy (no raw
auth ids serialized, masked email fallback, guests structurally excluded, hidden
and admin users excluded); admin boundary (requireAdmin on all pages and actions,
no admin module imported from public surfaces); mutation hardening (CSRF header,
zod, server-constant rate windows, non-empty ip_hash, server-enforced burn
confirmation); error hygiene; secret confinement; injection surfaces clean (no
dangerouslySetInnerHTML in scope); IDOR protections (no round-existence oracle).
Informational, non-blocking: (1) npm audit --omit=dev reports 4 moderate findings,
all one transitive postcss <8.5.10 advisory via nested next copies inside
@vercel/analytics and geist (build-time CSS tooling path; fix would force-downgrade
next; track as a post-launch dependency bump); (2) me/stats allowlists response
fields explicitly, hidden_reason/at/by excluded as required.

Phase 8 launch-checklist and environment review (Sonnet subagent, 2026-07-11):
  1. SIGNAL_SCOUT_IP_SALT: code path verified (route-helpers.ts falls back to the
     checked-in constant "ffbeacon-signal-scout-v1" when unset, so the salt is
     public and the ip-hash side of the guest cap is precomputable; feature still
     works). Documented in .env.local.example; NOT set in local .env.local.
     Production could NOT be verified from this machine (no vercel CLI installed,
     no .vercel project link). LAUNCH BLOCKER (owner action): confirm or set
     SIGNAL_SCOUT_IP_SALT for Production in the Vercel dashboard.
  2. x-forwarded-for: clientIp trusts the leftmost XFF entry; safe on the Vercel
     platform guarantee that the edge overwrites client-supplied XFF. OWNER
     POST-DEPLOY TASK recorded: after deploy, exhaust the 2-round guest cap, then
     attempt a third start with a rotated cookie and a spoofed
     X-Forwarded-For: 1.2.3.4; a 429 confirms the assumption, a 200 means the cap
     is bypassable and needs a fix.
  3. game_enabled gating: verified with file:line evidence. Public page renders
     SignalOfflineNotice when false; POST /round returns 503 game_disabled (route
     AND engine both enforce); mid-round routes (get/guess/hint/skip), search, and
     me/stats deliberately do not gate (disabling never strands an active round);
     leaderboards gate on their own flags by documented design. Hub and homepage
     cards link unconditionally and land on the offline notice while disabled
     (intentional per plan).
  4. Reserved-route guard: npx tsx scripts/check-reserved-routes.ts run standalone,
     exit 0, 19 folders covered; "games" present in RESERVED_ROUTE_SEGMENTS and in
     signal_reserved_handles (live SELECT).
  5. Migrations: 0123-0132 all on disk and all applied remotely
     (supabase_migrations.schema_migrations), no drift.
  6. Deployment surface: 3 public routes, 5 admin routes, 8 API routes, nav/footer/
     homepage touch points; the ONLY new env var is SIGNAL_SCOUT_IP_SALT; no new
     third-party services or keys.
  7. Settings code paths confirmed: no row resolves to defaults with game_enabled
     true (would launch LIVE on deploy); a stored game_enabled false parses through
     zod untouched and gates everything. Confirms the pre-flight blocker: the gate
     row must be inserted before any deploy (being seeded in SS-T044 step F and
     re-verified in SS-T046).

SS-T044 | completed | End-to-end verification (guest cap, burn paths, streak day rollover,
       full guest + logged-in rounds)
     | files: none modified (verification only; one DB state change: the
       signal_scout_settings gate row inserted, see notes)
     | notes: Sonnet subagent drove the real HTTP API against a local dev server
       (no browser). ALL scenarios PASS, zero contract deviations. Guest: 403
       without the ff-beacon header; round start with cookie mint; ownership
       returns uniform 404 (no existence oracle); duplicate start 409 with
       roundId. Anti-cheat exhibit captured: the raw active DTO carries only
       revealed clues, locked counts, costs, score, pips, badReads, guest flag;
       no target data, no unrevealed content, no specificity, no snapshot.
       Hints: 4 weak buys drain 900/800/700/600; 5th 409 tier_limit_reached;
       scan to 100; clear without confirmBurn 409 burn_confirmation_required,
       with confirmBurn burns to 0; further hints 409 signal_burned; a sub-6s
       double-fire captured a real 429 rate_limited. Burned round stayed
       guessable: wrong guess at 0, duplicate 409 guess_duplicate, correct guess
       completed solved_late with scoreAwarded 0 and the full 30-clue reveal.
       Guest cap: second round skipped (reveal present), third start 429
       guest_limit_reached, rotated cookie + same IP still 429 (ip side of
       max(cookie, ip) enforced). Failed path: three wrong guesses complete as
       failed at score 700. Won path: correct first guess awards the full 1000.
       Logged-in: session-cookie path succeeded first try (hand-built
       @supabase/ssr cookie from a password-grant session for a temp GoTrue
       user); won round wrote user_stats (played 1, won 1, streaks 1, points
       1000) and daily_scores (first_play_at set); daily streak rollover
       verified both directions via SQL date shifts (yesterday -> streak 2 with
       signal streak reset on skip and best held; 3-day gap -> daily streak
       reset to 1, best_daily_streak held at 2). Leaderboards: daily board row
       showed masked email identity ("si***"), isYou true, avatarUrl field
       present; raw auth uuid absent from the entire response body; guest GET
       401; me/stats 200 with the 17-key allowlisted shape (no
       hidden_reason/at/by), 401 without session. Offline gate: settings row
       inserted with game_enabled false (defaults otherwise), POST /round then
       503 game_disabled and the page rendered the Signal offline notice; ROW
       LEFT IN PLACE as the launch gate.
     | verified: yes (orchestrator independently re-queried the final DB state:
       gate row present with game_enabled false, all seven game tables at 0
       rows, e2e test auth user deleted; dev server confirmed stopped by the
       agent via port check after force-stopping a detached node child)
SS-T045 | completed | NVDA/keyboard + mobile audits (sub-agent + manual)
     | files (fixes): app/games/signal-scout/signal-scout-client.tsx,
       app/games/signal-scout/score-meter.tsx, app/games/signal-scout/status-bar.tsx,
       app/games/signal-scout/result-card.tsx,
       app/games/signal-scout/leaderboards/leaderboard-tabs.tsx,
       components/slide-up-dialog.tsx, components/nav-dropdown.tsx
     | notes: Sonnet code-level audit COMPLETE 2026-07-11 across the full public and
       admin scope. PASSED with evidence: heading outlines all phases, focus contracts
       (dialog trap, transition-scoped result focus), color-never-alone, zero
       responsive-hiding utilities, table semantics, timestamps all via lib/datetime,
       skip-link targets, WAI-ARIA combobox with ruled-out handling, banned-punctuation
       sweep clean. FINDINGS, all accepted for fixing by the orchestrator (fixes held
       until the SS-T044 dev server is down to avoid hot-reload flakiness):
       (1) MUST-FIX double announcement on hint reveal (polite live region sentence
       plus focus move to the clue cell reads the clue twice); disposition: trim the
       polite announcement to the score change only, and skip it entirely on a burning
       purchase since BurnedBanner role="alert" covers that case (also resolves the
       finding-7 polite+assertive overlap risk on the burn path);
       (2) slide-up-dialog.tsx transitions lack motion-reduce fallback (shared
       component, in the burn-confirm flow); (3) score-meter width transition lacks
       motion-reduce; (4) nav-dropdown chevron transition lacks motion-reduce;
       (5) leaderboard-tabs sm:min-h-0 drops the 44px floor at sm+ (accepted in Phase
       5 as league-tabs house pattern; overturned for launch: the 44px rule is
       non-negotiable and this is the only override in scope; remove sm:min-h-0);
       (6) result-card passes the player name to PlayerHeadshot while the same name is
       adjacent visible text (double read; every other call site uses the decorative
       alt convention); disposition: name="" with the adjacent text carrying the name.
       Manual NVDA walkthrough list for the owner recorded (7 steps: start round, hint
       reveal, burn-confirm dialog, wrong guess, all four completions, leaderboards +
       combobox keyboard-only, tab bar targets); it remains OUTSTANDING and is an
       owner launch-checklist item (no browser testing this session by instruction).
       FIXES APPLIED 2026-07-11 (Sonnet fixer subagent, orchestrator-reviewed):
       (1) hint success now announces only "Score {n} of {starting}." and nothing
       when the purchase burned (BurnedBanner alert covers it); focus move to the
       clue cell unchanged and carries the clue content; (2) slide-up-dialog backdrop
       and sheet transitions gained motion-reduce:transition-none (shared component);
       (3) score-meter width transition gained motion-reduce:transition-none;
       (4) nav-dropdown chevron gained motion-reduce:transition-none (shared);
       (5) leaderboard-tabs sm:min-h-0 removed, 44px floor now at every breakpoint
       (deliberate divergence from league-tabs); (6) status-bar Panel got
       id="signal-scout-status" so the section landmark is named (verified against
       dashboard-panel.tsx titleId wiring); (7) result-card PlayerHeadshot now
       decorative (name="") with the player name as adjacent visible text.
       Orchestrator also fixed 3 pre-existing em-dash comments in
       slide-up-dialog.tsx (Phase 7 in-scope precedent; comment text only).
     | verified: yes (orchestrator read the fix-1 region and the full
       slide-up-dialog.tsx raw, grep-confirmed all class/prop changes and zero
       banned punctuation remaining; fixer ran npm run typecheck clean and
       npx vitest run lib/signal-scout 245 tests pass; orchestrator re-ran
       npm run typecheck clean after the punctuation edits; git diff scope
       confirmed limited to the intended files; full-suite + production build
       verification happens in SS-T046; manual NVDA pass remains an owner
       launch-checklist item)
SS-T046 | completed | Production build, launch checklist, game_enabled launch-gate decision
     | files: none modified (verification and checklist consolidation; one DB state
       change carried from SS-T044: the signal_scout_settings gate row)
     | notes: full verification chain run by a Sonnet subagent after the SS-T045
       fixes landed: npm run typecheck clean; npx vitest run FULL suite 721 tests
       across 53 files, zero failures; npm run build completes end to end
       (reserved-route guard green: 19 folders covered; all 3 public routes, all 5
       admin routes, and all 8 API routes present in the route manifest; no build
       warnings); banned-punctuation sweep zero matches on all 7 fix-pass files;
       working tree untouched by verification (no stage/commit/revert).
       GAME_ENABLED DECISION: stays FALSE. The gate row (inserted and verified in
       SS-T044, re-verified live by the orchestrator) holds game_enabled false with
       defaults otherwise. Not flipped this session because launch blockers remain
       open (Vercel salt unverified, manual NVDA pass outstanding, code uncommitted
       and undeployed); the plan's launch-behind-game_enabled posture is satisfied
       by the gate row. To enable at launch: flip the toggle at
       /admin/signal-scout/settings (or update the row via service role) AFTER
       deploy and blocker clearance.
       LAUNCH CHECKLIST FINAL STATE:
       - [OWNER, BLOCKER] Set/confirm SIGNAL_SCOUT_IP_SALT in Vercel Production
         (unset falls back to a checked-in public constant; guest cap still works
         but the ip-hash side is precomputable). Unverifiable from this machine
         (no vercel CLI, no .vercel link).
       - [OWNER, POST-DEPLOY] Confirm Vercel overwrites client x-forwarded-for:
         exhaust the 2-round guest cap, then attempt a third start with a rotated
         cookie and header X-Forwarded-For: 1.2.3.4; expect 429 (a 200 means the
         cap is bypassable and needs a fix).
       - [OWNER, PRE-ENABLE] Manual NVDA walkthrough (7 steps recorded in
         SS-T045).
       - [DONE] Gate row in place (game_enabled false verified live).
       - [DONE] Reserved-route guard green; games segment in code and DB.
       - [DONE] Migrations 0123-0132 applied remotely, no disk drift.
       - [DONE] E2e verification all scenarios pass (SS-T044).
       - [DONE] Security review pass (zero critical/high/medium), a11y audit
         findings all fixed, build/typecheck/full suite green.
       - [FOLLOW-UP, NON-BLOCKING] npm audit: 4 moderate findings, one transitive
         postcss advisory via nested next copies in @vercel/analytics and geist
         (build-time path); track as a dependency bump later.
     | verified: yes (orchestrator reviewed all subagent evidence; DB gate state
       re-queried directly; typecheck re-run by orchestrator after final edits)

PHASE 8 CLOSED 2026-07-11. Orchestrated by Fable with Sonnet subagents (e2e flows,
a11y/mobile audit, security/privacy review, launch checklist/environment review,
a11y fixer, build/test verifier); the orchestrator reviewed every report, read the
behavioral fix regions raw, and independently re-verified the DB end state. Tasks:
SS-T044 (e2e: all scenarios pass, gate row seeded), SS-T045 (a11y audit + 7 fixes
across 5 game files and 2 shared components), SS-T046 (build/typecheck/full suite
green, launch checklist consolidated, game_enabled kept false). Security review:
PASS, zero critical/high/medium. Final state: typecheck clean, 721 tests across 53
files pass, production build ships all 16 Signal Scout routes, reserved-route guard
green, banned punctuation zero in all touched files, all game tables empty except
the deliberate game_enabled false gate row, e2e test artifacts fully cleaned
(including the temp auth user). NOT enabled for public play: game_enabled stays
false until the owner clears the three OWNER checklist items (Vercel
SIGNAL_SCOUT_IP_SALT, post-deploy XFF check, manual NVDA pass) and flips the toggle
in /admin/signal-scout/settings after deploy. Still pending owner decisions, not
Phase 8 scope: SS-T035 (optional round history), SS-T047 (snap-share/red-zone
clues). No commits or pushes per owner instruction (Phases 4-8 all uncommitted).
Signal Scout is READY FOR COMMIT AND REVIEW.

PHASE 8 FOLLOW-UP: launch-question resolution pass (2026-07-11, owner-requested,
orchestrated by Fable). Scope: resolve the question marks from the Phase 8 report
before commit/review. game_enabled NOT flipped (remains false, re-confirmed).
  1. Env var name CONFIRMED: SIGNAL_SCOUT_IP_SALT is the only correct name.
     "SIGNAL_CONFIG" appeared ONLY in the orchestrator's chat report header as a
     typo; repo-wide grep shows zero SIGNAL_CONFIG matches in any file, and
     SIGNAL_SCOUT_IP_SALT is consistent across code
     (lib/signal-scout/route-helpers.ts:108), tests, .env.local.example,
     progress.md, and handoff.md. No code mismatch existed; nothing to fix.
     A naming-mismatch regression test ALREADY exists
     (route-helpers.test.ts:76-107: fallback behavior plus "changes output when
     SIGNAL_SCOUT_IP_SALT is set vs the fallback"); no new test needed.
  2. Env documentation: the project convention is .env.local.example (no README,
     no env schema file exists; docs/ holds feature docs only). Updated the
     SIGNAL_SCOUT_IP_SALT entry there: placeholder value
     replace-with-long-random-secret (no real secret in the repo) and a comment
     stating it is optional locally but REQUIRED in Vercel Production with the
     fallback consequence spelled out. Also fixed one pre-existing em-dash in the
     CRON_SECRET comment (in-scope punctuation precedent).
  3. XFF launch check: clientIp confirmed as the house pattern (comment cites the
     app/api/on-the-clock/leagues/route.ts original; five other routes share the
     shape; leftmost-XFF and x-real-ip fallback are unit-tested). Guest cap
     confirmed as max(guest-cookie count, salted-ip-hash count) via the SS-T044
     live run. handoff.md rewritten with the exact staged post-deploy test
     (deploy gated, temporarily enable, exhaust cap via start/skip/start/skip,
     rotated-cookie spoofed-XFF third start, 429 = pass / 200 = do not launch,
     re-disable after testing). Note discovered while writing the steps: the cap
     test REQUIRES game_enabled temporarily true because POST /round returns 503
     game_disabled before the guest claim runs; the instructions now make that
     ordering explicit.
  4. NVDA checklist: copied and refined into handoff.md under "Manual NVDA
     Launch Check" covering round start, mystery profile and locked-slot
     reading, hint purchase, burn confirmation, wrong guess, result
     announcements, and leaderboards navigation. Status: NOT performed
     (cannot run NVDA in this session); remains an owner pre-enable action.
  5. npm audit re-run (npm audit --omit=dev): unchanged, 4 moderate, single
     root cause postcss <8.5.10 (GHSA-qx2v-qp2m-jg93) at
     node_modules/next/node_modules/postcss, reached via @vercel/analytics ->
     next and geist -> next. Only offered fix is npm audit fix --force
     installing next@9.3.3 (breaking downgrade; rejected). Non-blocking for
     launch; tracked as a post-launch dependency follow-up.
  6. Final verification re-run after the doc edits, all by the orchestrator:
     npm run typecheck clean; npx vitest run 721 tests across 53 files all pass;
     npm run build passes end to end (reserved-route guard green, 19 folders; all
     3 public + 5 admin + 8 API Signal Scout routes in the manifest; no warnings).
     game_enabled re-queried live: still false. Files changed in this pass:
     .env.local.example, progress.md, handoff.md only (no code changes; question 1
     required none). handoff.md now carries the exact Vercel salt instructions,
     the staged post-deploy XFF test with copyable curl commands, the Manual NVDA
     Launch Check (status: not performed, owner pre-enable action), and the npm
     audit disposition. READINESS: safe to commit/review YES; safe to enable
     publicly NO until the three owner actions (Vercel salt, XFF test, NVDA
     walkthrough) are green.

---

## Power Pulse (League Pulse expected-performance ranking)

Goal: a primary power ranking driven by expected competitive performance rather
than trade value, with the value ranking preserved alongside it.

T400 | completed | Migration 0162: league_matchups (Sleeper H2H schedule + results)
     | files: supabase/migrations/0162_league_matchups.sql
     | verified: yes (RLS confirmed via pg_policy: select_public + service_role_all)

T401 | completed | Migration 0163: nfl_defense_vs_position (our own opponent model)
     | files: supabase/migrations/0163_nfl_defense_vs_position.sql
     | verified: yes (RLS confirmed)

T402 | completed | Migration 0164: player_projection_accuracy (recency-weighted reliability)
     | files: supabase/migrations/0164_player_projection_accuracy.sql
     | verified: yes (RLS confirmed; partial unique index guards the blended row)

T403 | completed | Migration 0165: league_power_pulse_cache
     | files: supabase/migrations/0165_league_power_pulse_cache.sql
     | verified: yes (RLS confirmed)

T404 | completed | Migration 0166: league_power_pulse_settings (admin-tunable model)
     | files: supabase/migrations/0166_league_power_pulse_settings.sql
     | verified: yes (service-role only, matching on_the_clock_settings)

T405 | completed | League-native scoring engine
     | files: lib/league-scoring.ts, lib/league-scoring.test.ts
     | verified: yes (15 tests; reproduces Sleeper's own PPR number to within 0.03)

T406 | completed | Sleeper matchups endpoint
     | files: lib/sleeper.ts (getSleeperMatchups)
     | verified: yes (live check: full 1-18 slate available in the preseason)

T407 | completed | Power Pulse model types, defaults, settings loader, math
     | files: lib/power-pulse/types.ts, default-settings.ts, settings.ts, math.ts, math.test.ts
     | verified: yes (18 tests)

T408 | completed | Exact optimal lineup fill
     | files: lib/power-pulse/lineup.ts, lineup.test.ts
     | verified: yes (14 tests, including the non-nested slot case plain greedy fails)

T409 | completed | Monte Carlo season + bracket simulation
     | files: lib/power-pulse/simulate.ts, simulate.test.ts
     | verified: yes (8 tests; playoff odds sum to exactly the field size, title odds to 1)

T410 | completed | Data loading + engine
     | files: lib/power-pulse/load.ts, lib/power-pulse/engine.ts
     | verified: yes (run against 5 structurally different leagues)

T411 | completed | Opponent strength calculator
     | files: lib/calculate-defense-splits.ts, scripts/calculate-defense-splits.ts
     | verified: yes (1,728 rows across 2023-2025; real 0.80-1.25 spread vs Sleeper's flat 3-5%)

T412 | completed | Recency-weighted reliability calculator
     | files: lib/calculate-projection-accuracy.ts, scripts/calculate-projection-accuracy.ts
     | verified: yes (5,634 rows, 796 players; blended values verifiably lean to the current season)

T413 | completed | Schedule sync + orchestrator, wired into pulseLeague
     | files: lib/league-matchups.ts, lib/league-power-pulse.ts, lib/league-pulse.ts
     | depends on: T400, T406, T410
     | verified: yes (12-hour TTL, week-advance and model-version staleness, never throws)

T414 | completed | CLI: npm run calculate:power-pulse
     | files: scripts/calculate-league-power-pulse.ts, package.json
     | verified: yes (all/one-league/force modes)

T415 | completed | Read layer + league leaders
     | files: lib/league-power-pulse-data.ts
     | verified: yes (tie detection surfaces "Tied with N other teams" honestly)

T416 | completed | Power Pulse tab (new route + NEW badge)
     | files: app/leagues/[league_id]/power-pulse/page.tsx, components/league-tabs.tsx
     | verified: yes (a11y audited below)

T417 | completed | Power Pulse UI components
     | files: components/power-pulse/{pulse-detail,pulse-rankings-table,pulse-leaders,
     |        projected-standings,title-race,how-power-pulse-works,rank-mode-toggle}.tsx
     | verified: yes (headings H1>H2>H3, no skips; all mobile-hidden columns present in the sheet)

T418 | completed | Overview rankings default to Power Pulse, value shown alongside
     | files: app/leagues/[league_id]/page.tsx, components/power-rankings-row.tsx
     | verified: yes (?rank=value restores value ordering; both numbers always visible)

T419 | completed | Admin model tuning page
     | files: app/admin/power-pulse/{page,actions,power-pulse-settings-manager}.tsx,
     |        lib/power-pulse/validate.ts, components/admin-nav.tsx
     | verified: yes (requireAdmin + zod validation + service-role write; save round trip confirmed)

T420 | completed | Docs
     | files: CLAUDE.md (Power Pulse section + route list), progress.md
     | verified: yes

### Verification summary
- npm run typecheck: clean
- npx vitest run: 1000 tests across 77 files, all pass
- npm run build: passes end to end; /leagues/[league_id]/power-pulse in the manifest
- RLS: all 5 new tables confirmed via pg_policy query (4 public-read + service-role,
  1 service-role-only for the settings row)
- Browser: no console errors or React warnings on the new route
- Accessibility (self-audited, no sub-agent dispatched per session instruction):
  heading outline H1 > H2 > H3 with no skips; table caption describes every column;
  score cells carry aria-labels naming rank and value; rank-mode control uses real
  radiogroup/radio semantics; bottom sheet traps focus, restores it, and locks body
  scroll; the driver list is an <ol> with an sr-only tone word so colour is never
  the only signal; details/summary used for the methodology disclosure.
- Mobile-first: 4 columns hide below md (Value rank, Proj., Playoffs, Lineup) and all
  4 are rendered in the bottom sheet, verified by DOM inspection.
- Security (self-audited): no new public API endpoints; admin action gated by
  requireAdmin + zod + service-role; sleeper ids filtered to /^[A-Za-z0-9]{1,32}$/
  before PostgREST .or() interpolation; league id encoded in the new Sleeper URL.

### Known gaps / follow-ups
- Player news is NOT an input. news_items has 0 rows and nothing writes to it.
  Injury status and depth-chart order (already synced on players.metadata.sleeper)
  cover the practical case. A real news signal needs an ingestion source first.
- Weekly outcomes are modelled as independent; no QB-to-receiver stack correlation.
- The playoff bracket reseeds each round rather than using Sleeper's fixed bracket.
- Backtest against completed seasons not yet run (2 completed 2025 leagues available).

## Profile navigation bug + profile load time (2026-08-02)

Reported: clicking through profiles from search or the rankings list eventually
"stops loading", and a manual refresh fixes it. Root cause was navigation, not
data. See the per-task notes for what each piece contributed.

T421 | completed | Reset scroll to the top on every route change
     | files: components/route-scroll-reset.tsx, app/layout.tsx
     | verified: yes (rankings at 4000px -> profile lands at 0; back restores 4000)

T422 | completed | Site-wide error boundaries
     | files: app/error.tsx, app/global-error.tsx
     | depends on: none
     | verified: yes (throwing route renders the boundary at HTTP 500, app still
     |           navigates client-side afterward; /foo, /brief/bogus, /players/bogus
     |           all still answer 404, so no soft-404 regression)

T423 | completed | Split the trade player resolver so one unindexable branch stops
     |             forcing a seq scan on players
     | files: lib/player-trades.ts
     | verified: yes (indexed external-id pass first, slug-suffix wildcard pass runs
     |           only for ids the first pass missed, normally none)

T424 | completed | Cache the profile's cross-league trade lookup and news teaser
     | files: lib/cache-tags.ts, lib/player-profile.ts, lib/player-profile-cache.ts,
     |        components/player-profile/{overview-tab,trades-tab,quick-news}.tsx
     | depends on: T423
     | verified: yes (Overview 560ms -> ~180ms warm; Trades tab 1.27s -> ~0.70s warm,
     |           the remainder being the deliberately uncached Signal Check grading)

T425 | completed | Search palette closes on a completed route change
     | files: components/site-search.tsx
     | depends on: none
     | verified: yes (palette closed and body scroll released after selecting a result)

### Verification summary
- npm run typecheck: clean
- npm test: 1009 tests across 78 files, all pass
- npm run build: passes end to end; /error and /global-error both in the app build
  manifest
- HTTP status regression check on a production build, the concern documented in
  app/leagues/loading.tsx: /foo-does-not-exist 404, /brief/bogus-slug 404,
  /players/not-a-real-player 404, /rankings 200. Adding error.tsx does not
  reintroduce the soft-404 problem a root loading.tsx caused, because Next
  re-throws the notFound() sentinel past error boundaries.
- Browser: rankings -> profile, search -> profile, and profile -> profile all land
  at scroll 0; back restores the prior position; no console errors or warnings.
- Accessibility (self-audited, no sub-agent dispatched per session instruction):
  both error pages use role="alert" with a single H1, real button/link controls at
  min-h-11, visible focus rings, and aria-hidden on the decorative icon.
  RouteScrollReset renders nothing and adds no ARIA surface.
- Mobile-first: no responsive utility hides data; the error pages use sm: only for
  type scale and padding.
- Security (self-audited): no new endpoints, writes, or secrets. The cached trade
  and article reads move to the cookie-less anon client, which is a strict subset
  of what the request client could see because every table involved is public-read
  and find_player_trade_transactions is SECURITY INVOKER granted to anon. Cache keys
  are built from database-derived ids, not request input. error.digest is Next's
  hashed reference, not a stack trace.

### Known gaps / follow-ups
- Profile routes still have no loading indicator, so a slow first paint shows the
  previous page unchanged. A root loading.tsx is the wrong fix (soft 404s); a
  per-route one under /players would work if the TTFB ever justifies it.
- Link prefetching is left on everywhere. It costs server work per row on the
  rankings list, but turning it off would make the click itself slower, which is
  the opposite of the goal here.
- The header runs supabase.auth.getUser() on every render on top of the same call
  in middleware, so each full page load pays for two auth round trips.

## League Pulse entry list: auto-search, standings figure, Sync button (2026-08-03)

T426 | completed | Saved Sleeper handle searches itself on the League Pulse entry page
     | files: app/tools/league-pulse/page.tsx
     | depends on: none
     | verified: yes (no redirect, so the URL stays clean and the back button is not
     |   trapped; ScrollToResults now fires only when the reader actually submitted
     |   the form, so a plain visit no longer yanks focus past the hero; a saved
     |   handle Sleeper cannot resolve gets its own error copy naming the handle as
     |   saved rather than mistyped)

T427 | completed | Shared value formatter lifted out of the team card
     | files: lib/format-value.ts, components/team-card.tsx
     | depends on: none
     | verified: yes (single definition, team card behaviour unchanged)

T428 | completed | One definition of projected-finish order
     | files: lib/power-pulse/projected-order.ts, lib/power-pulse/projected-order.test.ts,
     |   components/power-pulse/projected-standings.tsx
     | depends on: none
     | verified: yes (4 tests; the league list and the Projected final standings table
     |   inside a league now sort through the same comparator, so a row that promises
     |   3rd and a league that then says 4th is a structural impossibility rather than
     |   a comment nobody rereads)

T429 | completed | Standing figure data: projected seed, ranked count, exact-match value
     | files: lib/league-team-status-data.ts
     | depends on: T428
     | verified: yes (Power Pulse rows are now read for EVERY roster in the league,
     |   because a finish is a position among the others, and that read is paged with a
     |   stable order because one row per (league, roster, season) clears the silent
     |   1000-row cap for a heavy Sleeper user; the value read stays scoped to the
     |   searched roster; valueIsExact is true only when a cached row matches BOTH the
     |   league's derived format and the reader's source)

T430 | completed | Standing figure wording and rendering
     | files: lib/team-standing-figure.ts, lib/team-standing-figure.test.ts,
     |   components/team-standing-figure.tsx
     | depends on: T429
     | verified: yes (9 tests. Competitor and Middle show the projected finish with a
     |   gold, silver, or bronze trophy on the top three and a plain ordinal below
     |   that; Rebuilder shows total roster value and its rank instead. Every sentence
     |   names its measure, "by expected wins" or "by roster value", because the tag's
     |   own explanation quotes Power Pulse and a hard schedule pulls the two apart. A
     |   rebuilder with no exact-match value row falls back to the finish rather than
     |   printing a number from the wrong format)

T431 | completed | Per-visitor sync throttle ledger
     | files: supabase/migrations/0168_league_sync_attempts.sql, lib/database.types.ts
     | depends on: none
     | verified: yes (RLS on with a single service_role ALL policy; anon and
     |   authenticated hold no table privilege and no EXECUTE on either function,
     |   confirmed against prod via pg_policies and has_*_privilege. Claim semantics
     |   exercised in a begin/rollback probe: first claim wins, a second while in
     |   flight is refused, a claim inside the cooldown is refused, a claim after the
     |   cooldown wins, an abandoned claim past its lease is taken over, and an empty
     |   actor key fails closed)

T432 | completed | Public sync endpoint
     | files: app/api/leagues/[league_id]/sync/route.ts, lib/rate-limit-actor.ts
     | depends on: T431
     | verified: yes (live: 400 on a malformed id, 403 without the same-origin header,
     |   429 reason "in_flight" for a second league while one is syncing, 429 reason
     |   "cooldown" immediately after one finishes, 200 again 5.5s later. Slot released
     |   in a finally so a failure costs a cooldown, not a lockout. Actor key derived
     |   server-side from the session, else a salted hash of the trusted client IP;
     |   a missing salt returns a controlled 503 rather than an unlimited slot)

T433 | completed | Sync queue and button
     | files: lib/league-sync-queue.tsx, components/league-sync-button.tsx
     | depends on: T432
     | verified: yes (one sync at a time across every league on the page and across
     |   both breakpoint renderers; 5s cooldown after each attempt; every unavailable
     |   state says why in words and keeps aria-disabled rather than disabled so the
     |   control stays reachable; countdown in the label; a single polite live region
     |   for the whole list)

T434 | completed | Wire the figure and the button into all four renderers plus the sheet
     | files: app/tools/league-pulse/league-results.tsx,
     |   app/tools/league-pulse/league-detail-sheet.tsx,
     |   app/my-beacon/sleeper-leagues/page.tsx
     | depends on: T430, T433
     | verified: yes (both public lists became stretched-overlay rows because a button
     |   nested inside a link is invalid markup; the tag and figure are aria-hidden
     |   there since the row's own name already reads them, while the Sync button
     |   stays exposed; the dashboard table needed no restructure and keeps its cells
     |   readable; the mobile dashboard card moves the standing out of the link)

### Verification summary
- npm run typecheck: clean
- npm test: 1022 tests across 80 files, all pass (13 new)
- npm run build: compiles clean, no warnings
- Live render against a real Sleeper account with 68 leagues: the projected finish,
  the trophy, the rebuilder value figure, and the Sync buttons all render server-side.
  Three leagues synced through the new endpoint and their rows moved from "Not yet
  synced" to a real tag plus figure on the next load.
- The divergence the projected finish exists to show is visible in real data: one
  roster sits 6th of 12 by Power Pulse and projects to finish 2nd, and another sits
  8th of 10 by Pulse while holding the 2nd most value in its league.
- Accessibility (self-audited, no sub-agent dispatched per session instruction):
  trophy colour is never the only signal, the ordinal is spelled out beside it and
  the screen-reader sentence names the measure; the FF Beacon mark stays decorative
  and only appears when the FF Beacon source is selected; Sync keeps a 44px tap
  target and announces through one polite region rather than one per row.
- Mobile-first: every figure and every Sync button renders at both breakpoints. No
  responsive utility hides data.
- Security (self-audited): the new endpoint is public by design like /warm and
  /refresh beside it, guarded by the same-origin header, an atomic per-visitor claim
  behind a row lock, and a league id regex that runs before the value reaches any
  Sleeper URL. Errors return generic copy; the real message goes to the server log.

### Known gaps / follow-ups
- A league whose Sleeper scoring matches none of the 8 active formats
  (format_config_id null, "Unmatched") cannot produce an exact-match value row, so a
  Rebuilder there shows its projected finish instead of its roster value. Correct
  behaviour, but the tag's own explanation still quotes a value rank picked by the
  looser fallback chain in lib/league-team-status.ts, so the sentence can name a rank
  whose number is not shown. Pre-existing; fixing it means changing the tag on every
  surface that renders it.
- The Sync button's one click is consumed on failure only for the length of the
  cooldown, after which it re-offers as "Try again". Burning the attempt permanently
  on a network blip would punish the reader for our failure.
- LEAGUE_SYNC_IP_SALT is not set; the guest limit key falls back to
  SIGNAL_SCOUT_IP_SALT, which is present. Splitting them is optional, but the sync
  endpoint returns 503 for guests if BOTH are ever missing in production.

T435 | completed | Fix: hover speech broken on the league list
     | files: app/tools/league-pulse/league-results.tsx
     | depends on: T434
     | verified: yes (regression introduced by T434. The row link had been turned into
     |   an empty absolutely-positioned overlay and every cell made
     |   pointer-events-none, so the pointer always hit-tested to the link, and the
     |   link had no text in it. On top of that the cells carrying the text were
     |   aria-hidden, so there was nothing in the accessibility tree to find either.
     |   Reading by hover had nothing to read. Fixed by putting the content back
     |   inside a real link that covers the first three columns via
     |   grid-cols-subgrid, which keeps the alignment the shared grid template exists
     |   for, and moving the "Your team" column outside the link as its own cell
     |   because it holds a button. Every aria-hidden and every pointer-events-none
     |   added in T434 is gone. Verified in rendered HTML: 0 overlay links, 0
     |   pointer-events-none cells, and the league name, season, status, and team
     |   count all sit inside the link as real text)

T436 | completed | Projected finish and roster value render as pills, not loose text
     | files: components/team-standing-figure.tsx,
     |   app/tools/league-pulse/league-results.tsx,
     |   app/tools/league-pulse/league-detail-sheet.tsx
     | depends on: T430
     | verified: yes (built to the same recipe as TeamStatusBadge: icon, fill, border,
     |   glow. Gold, silver, and bronze with a trophy for the top three; a neutral
     |   pill with a finish-line flag below that; a purple pill carrying the FF Beacon
     |   mark, the value, a rule, and the rank for rebuilders. Sits beside the status
     |   tag on a wrapping row rather than under it, so the two read as one unit.
     |   Confirmed in the production CSS bundle that Tailwind emitted the arbitrary
     |   medal colours and grid-cols-subgrid)

T437 | completed | Sync control condensed to a gradient pill
     | files: components/league-sync-button.tsx
     | depends on: T433
     | verified: yes (same dimensions as the tags it sits beside, px-2.5 py-1
     |   text-[11px] rounded-full, carrying the beacon purple-to-cyan gradient so it
     |   reads as the one pressable thing on the row. The 44px touch target moved to
     |   the button BOX, h-11 at mobile widths and md:h-auto above, so a desktop row
     |   is not padded out by space no mouse needs while a finger still gets its
     |   target. The permanent status paragraph under every button is gone: the reason
     |   now reaches a screen reader through aria-describedby on an sr-only element
     |   and is only rendered visibly when it is an actual error)

### Verification summary (second pass)
- npm run typecheck: clean
- npm test: 1022 tests across 80 files, all pass
- npm run build: compiles clean, no warnings
- Rendered against the same 68-league account: 68 subgrid rows, 0 overlay links, 0
  pointer-events-none cells, 128 gradient sync pills, and the silver trophy pill and
  the rebuilder value pill both present with title and aria-label intact.
- All local dev servers stopped; ports 3000 through 3003 confirmed free.

### Lesson worth keeping
Never hide row content a reader might point at. aria-hidden on cells whose text is
already in the row's accessible name looks like a clean de-duplication and silently
breaks reading by hover, which depends on finding something real under the pointer.
Same for pointer-events-none: it changes what the pointer hit-tests to, which is the
same thing a screen reader following the mouse resolves against.

T438 | completed | Projected finish pill reads "Proj 2nd", not "2nd of 12"
     | files: components/team-standing-figure.tsx
     | depends on: T436
     | verified: yes (the row already states the league's team count, so the pill was
     |   repeating it. The spoken sentence keeps "of 12" because it is heard on its
     |   own with none of that surrounding context)

T439 | completed | "Middle of the pack" renamed to "Mid Tier"
     | files: lib/league-team-status.ts, app/tools/league-pulse/league-results.tsx,
     |   plus doc comments in app/api/leagues/[league_id]/sync/route.ts,
     |   app/leagues/[league_id]/page.tsx,
     |   app/leagues/[league_id]/teams/[roster_id]/page.tsx,
     |   components/power-rankings-row.tsx, components/team-card.tsx,
     |   components/team-filter.tsx, components/team-status-badge.tsx,
     |   lib/league-power-pulse-data.ts, lib/team-standing-figure.ts
     | depends on: none
     | verified: yes (one label constant feeds every surface, so the league list, the
     |   deep view, the team cards, the rankings rows, and the team filter all changed
     |   together. Short form is now "Mid". The unrelated "Middle of the pack" driver
     |   label in lib/power-pulse/engine.ts is a Power Pulse driver, not this tag, and
     |   was deliberately left alone. Confirmed in rendered HTML: 0 occurrences of the
     |   old string, 9 of the new one)

T440 | completed | Rebuilders always show roster value, never a projected finish
     | files: lib/league-team-status-data.ts, lib/team-standing-figure.ts,
     |   components/team-standing-figure.tsx, lib/team-standing-figure.test.ts
     | depends on: T436
     | verified: yes (the bug: hasValueFigure demanded a value row matching BOTH the
     |   league's derived format and the reader's source. 22 of 109 synced leagues
     |   carry format_config_id null, the "Unmatched" case, and can never match, so
     |   those Rebuilders silently fell through to a projected finish, which is the one
     |   number a rebuild is not measured by.
     |
     |   Fixed at the source: the tag and the printed figure now read the SAME value
     |   row, chosen by one fallback chain (exact, then league format, then reader's
     |   source, then anything, sorted first so the last resort is stable across
     |   renders). Previously the tag walked that chain while the figure insisted on an
     |   exact match, so a row could say "3rd by value" and then decline to show the
     |   value it had just ranked. That closes the known gap logged under T429.
     |
     |   valueIsExact survives as wording only: an inexact figure appends "This
     |   league's scoring does not match a format we carry values for, so this is our
     |   closest match" to the spoken sentence.
     |
     |   Made unmistakably a value rank rather than a finish: the pill now reads
     |   "3rd by value" instead of a bare "3rd", and its icon is Coins rather than the
     |   finish-line Flag the projected-finish pill uses. Verified across the rendered
     |   page: 6 Rebuilder rows, 6 value pills, 0 projected-finish pills)

### Verification summary (third pass)
- npm run typecheck: clean
- npm test: 1023 tests across 80 files, all pass
- npm run build: compiles clean, no warnings
- Rendered against the 68-league account. Rebuilder to value pill: 6 of 6. Mid Tier
  to projected-finish pill: 2 of 2. No Rebuilder renders a projected finish.
  The previously-broken Unmatched league now shows "88,333 6th by value" with the
  closest-match caveat in its spoken sentence, where it used to show "Proj 8th".
- All dev servers stopped; ports 3000 through 3005 confirmed free.

### Note on cleaning up dev servers
TaskStop kills the `npm run dev` wrapper but NOT the Next child process
(`node .../next/dist/server/lib/start-server.js`), which keeps holding its port.
That is why orphans accumulated across sessions. Kill by process, not by task:
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*ffbeacon*start-server.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
then confirm with Get-NetTCPConnection on 3000-3005.

T441 | completed | Rebuilder value pill reads "98,808 (3rd)"
     | files: components/team-standing-figure.tsx
     | depends on: T440
     | verified: yes (dropped the vertical rule and the words "by value", which cost
     |   most of the pill's width. What the ordinal measures is still carried by the
     |   coins mark, the purple tone matching the Rebuilder tag beside it, and the
     |   hover and screen-reader sentence, which is unchanged and still reads "ranked
     |   3rd of 12 by roster value" in full)

T442 | completed | Desktop "Your team" column widened to fit both pills on one line
     | files: app/tools/league-pulse/league-results.tsx
     | depends on: T441
     | verified: yes (13.5rem to 16rem. The widest pair it has to hold is a Rebuilder
     |   tag next to a six-figure value with its rank, about 230px including the gap,
     |   so 16rem clears it with room. The cell still wraps, so a long value degrades
     |   rather than overflows. The league-name track is minmax(0,1fr) and absorbs the
     |   difference, leaving it around 700px at full container width. Confirmed 70 rows
     |   on the new track and no 13.5rem left in the output)

T443 | completed | Mobile row shows the team standing instead of the league status
     | files: app/tools/league-pulse/league-results.tsx
     | depends on: T441
     | verified: yes (mobile grid goes from three tracks to two: league identity and
     |   the chevron. The league-status badge is gone from the row and the standing
     |   pills take the width it held, because on a phone the list is scanned to see
     |   how YOU are doing, and how the league is doing is not that.
     |
     |   Mobile-first rule still satisfied. The league status is not hidden, it is
     |   relocated: it stays in the row button's accessible name, so a screen reader
     |   hears it on every row, and the detail sheet the button opens leads with it as
     |   a badge and repeats it as a fact card. Confirmed in the rendered page: 0
     |   league-status badges inside the md:hidden list, 59 still inside the md:block
     |   list, team-status pills present in both, and the mobile button's aria-label
     |   still reads "Open details for X, In Season, 12 teams. Your team: Rebuilder...".
     |
     |   The my-beacon dashboard cards were deliberately left alone: they are a card
     |   layout rather than a table view, and they already show both)

### Verification summary (fourth pass)
- npm run typecheck: clean
- npm test: 1023 tests across 80 files, all pass
- npm run build: compiles clean, no warnings
- All dev servers stopped by process (not by task, see the note above); ports 3000
  through 3005 confirmed free.

## Sync all (My Sleeper Leagues, signed-in only)

T444 | completed | Queue tables + enqueue/claim RPCs for Sync all
     | files: supabase/migrations/0172_league_bulk_sync_queue.sql
     | depends on: T439
     | verified: yes (league_bulk_sync_requests + league_sync_jobs, both RLS-on with
     |   service_role ALL and an owner-only SELECT, plus explicit table grants so the
     |   policy has something to permit. Confirmed against prod: anon has nothing on
     |   either table, authenticated has SELECT and nothing else, service_role has all
     |   four. enqueue_bulk_league_sync and claim_league_sync_jobs are EXECUTE
     |   service_role only for public, anon, and authenticated alike (all three named,
     |   because revoking from public leaves Supabase's named grants in place).
     |
     |   The 12-hour limit lives inside the enqueue RPC behind pg_advisory_xact_lock,
     |   not in the route, so two clicks landing together take turns instead of both
     |   reading "no request in the window". A partial unique index on
     |   (user_id, sleeper_league_id) where status in (pending, processing) is what
     |   stops a league being queued twice; the RPC leans on it with ON CONFLICT DO
     |   NOTHING rather than pre-checking.
     |
     |   Exercised end to end on prod inside begin/rollback: first press queued 3 of 4
     |   (blank league id dropped, empty name stored as null), second press inside the
     |   window returned cooldown with 43200s, claim_league_sync_jobs(2) flipped two to
     |   processing and left the third pending, a further claim took the last one, and
     |   a press with the cooldown at 0 while all three were in flight returned
     |   already_queued and left exactly 1 request row, proving the no-op press does
     |   not spend the window. Post-rollback both tables were back to 0 rows)

T445 | completed | Queue library: enqueue, progress read, and the worker
     | files: lib/league-bulk-sync.ts, lib/league-bulk-sync-types.ts
     | depends on: T444
     | verified: yes (worker claims up to 5 jobs a run, paces 2.5s between leagues,
     |   stops at a 50s soft budget and releases whatever it did not reach so the next
     |   minute picks it up rather than waiting out the stale window. Failures back off
     |   30s, 60s, 120s and fail after 3 attempts. A reaper reclaims anything left
     |   processing past 10 minutes through the same backoff, so a job that kills its
     |   worker cannot loop forever. Every transition is guarded on the status the job
     |   was in, so overlapping runs cannot both decide the same job's fate.
     |
     |   Jobs run pulseLeagueCore then pulseLeagueDerived with NO force, so an
     |   already-fresh league costs one indexed read and no Sleeper traffic. Worst case
     |   is about 200 Sleeper calls a minute against guidance of a thousand.
     |
     |   Types and constants live in league-bulk-sync-types.ts, split out so the client
     |   components can import them without pulling this module's Sleeper and
     |   service-role chain into the browser bundle)

T446 | completed | POST/GET /api/leagues/bulk-sync, auth-gated
     | files: app/api/leagues/bulk-sync/route.ts
     | depends on: T445
     | verified: yes (401 without a session, which is what makes this different from
     |   /warm, /refresh, and /[id]/sync beside it: those can only cause the work one
     |   page load would cause, this multiplies by the caller's league count. Requires
     |   the x-requested-with header like every other write here.
     |
     |   The league list is resolved server-side from the Sleeper handle saved on the
     |   account. The request body is never read, so a caller cannot name the leagues
     |   to queue, cannot spend another user's window, and cannot aim our sync at
     |   leagues picked for how expensive they are.
     |
     |   A cheap cooldown pre-check runs before the two Sleeper lookups so a caller in
     |   cooldown does not make us do the work anyway; the RPC re-checks under the lock
     |   and remains the real gate. On success, after() runs one worker pass as a head
     |   start, which is also what makes the queue observable in local dev where no
     |   cron fires)

T447 | completed | Every-minute cron worker + registry entry
     | files: app/api/cron/league-sync-worker/route.ts, vercel.json, lib/cron-runs.ts
     | depends on: T445
     | verified: yes (CRON_SECRET bearer via verifyCronRequest, wrapped in
     |   recordCronRun so the admin cron health panel picks it up from the CRON_JOBS
     |   registry with no separate wiring. Idle runs cost one indexed read against the
     |   partial pending index. Sits alongside beacon-brief-worker on * * * * *)

T448 | completed | Sync all button, notice container, and progress polling
     | files: components/league-sync-all.tsx
     | depends on: T446
     | verified: yes (button carries the beacon gradient like the per-row Sync, uses
     |   aria-disabled rather than disabled so a reader can reach it and hear why it
     |   is unavailable, and keeps a 44px box at mobile widths.
     |
     |   The notice is a plain role="region" with an accessible name, NOT a live
     |   region. A separate sr-only role="status" carries exactly three announcements:
     |   started, finished, failed to start. Progress counts update visually on an 8s
     |   poll and are never announced, because routing a poll through a live region
     |   would interrupt the reader every few seconds to say a number moved by one.
     |
     |   Polling runs only while a batch is active, so an idle page makes no requests.
     |   Page refreshes during a batch are floored at 30s: the standings come from the
     |   server render and that render re-resolves the league list from Sleeper, so
     |   refreshing per completed job would spend two Sleeper calls a league to watch a
     |   list update.
     |
     |   Copy states the queue fact plainly ("you can leave this page") because it is
     |   true: nothing about the work depends on the browser staying open. Time
     |   estimate is "a minute or two" up to 8 leagues and "a few minutes" past that,
     |   rather than a fake precision the worker cannot promise)

T449 | completed | Rows report their place in the batch
     | files: components/league-sync-button.tsx, app/tools/league-pulse/league-results.tsx
     | depends on: T448
     | verified: yes (LeagueQueuedBadge replaces the per-row Sync button for exactly
     |   as long as a league is pending or processing, so the reader cannot spend their
     |   single-league slot on work already queued; the button returns if the job
     |   fails, which is the point where there is something to do again. A league that
     |   already has a tag keeps it and gains the badge alongside, so "all leagues turn
     |   to syncing" holds for every row, not only the unsynced ones.
     |
     |   The badge is a plain span with real text, matching the Sync button's sizing so
     |   a part-drained list does not jump. Row accessible names lead with "Queued for
     |   syncing." / "Syncing now." via describeTeamStanding. No data is hidden at any
     |   breakpoint: both dashboard renderers get the same bulkStatuses map)

T450 | completed | Wire the dashboard page, keep the public tool out of it
     | files: app/my-beacon/sleeper-leagues/page.tsx, app/tools/league-pulse/league-results.tsx
     | depends on: T448
     | verified: yes (the page reads the newest batch through the reader's OWN session
     |   client, so the owner-select policies scope it rather than a filter we
     |   remembered to write. Passing bulkSync is what turns the feature on:
     |   LeagueResults renders LeagueSyncAll only when the prop is present, and
     |   app/tools/league-pulse/page.tsx never passes it, so the public tool keeps its
     |   one-league-at-a-time button and cannot reach Sync all. Confirmed by grep: the
     |   only caller passing bulkSync is the my-beacon page.
     |
     |   Server render and client poll both describe the same batch and can resolve out
     |   of order, so mergeBulkSyncState decides: a server copy wins only for a
     |   different batch or equal-or-further progress, never when behind. Equal
     |   progress is taken on purpose so the closing read lands and the page stops
     |   saying "syncing")

T451 | completed | Local worker CLI
     | files: scripts/run-league-sync-worker.ts, package.json
     | depends on: T445
     | verified: yes (npm run worker:league-sync for one pass, -- --watch to drain
     |   until empty. Vercel cron does not fire against a local dev server, so this is
     |   how a queued batch is observed end to end in development)

T452 | completed | mergeBulkSyncState unit tests
     | files: lib/league-bulk-sync-types.test.ts
     | depends on: T450
     | verified: yes (6 cases covering the orderings that actually happen: new batch,
     |   first batch seen, further progress, a stale server copy that must be dropped,
     |   a failure counting as progress, and the equal-progress close)

### Verification summary (Sync all)
- npm run typecheck: clean
- npm test: 1048 tests across 82 files, all pass (6 new)
- npm run build: compiles clean, no warnings; /api/leagues/bulk-sync and
  /api/cron/league-sync-worker both registered as dynamic routes
- Supabase security advisors: no new findings. claim_league_sync_jobs initially
  tripped function_search_path_mutable and was pinned to
  "search_path = public, pg_temp", matching the hardened bb_claim_jobs. The four
  remaining warnings (pg_trgm in public, and three pre-existing SECURITY DEFINER
  functions) all predate this work.
- RLS + grants + RPC behaviour verified against prod inside begin/rollback; both
  tables confirmed back to 0 rows afterwards.

## Trade Finder (League Pulse tab + My Sleeper Leagues panel)

T453 | completed | Pass-list table for Trade Finder suggestions
     | files: supabase/migrations/0173_trade_suggestion_declines.sql
     | depends on: T452
     | verified: yes (trade_suggestion_declines, RLS on with service_role ALL plus the
     |   four owner-scoped policies. UPDATE carries both USING and WITH CHECK so an
     |   owner cannot re-point a row at another user_id; that policy exists at all only
     |   because passing the same deal twice pushes expires_at out through an upsert,
     |   and without it the second press would fail the unique index and read as a dead
     |   button. Confirmed against prod: anon has no grants at all, authenticated has
     |   select/insert/update/delete and nothing else.
     |
     |   Owner writes are allowed here, unlike most tables in this schema, because the
     |   row IS the user's own opinion and carries no privilege: the worst a forged row
     |   can do is hide a suggestion from the forger. Nothing to gain by lying, so no
     |   reason to route it through a service-role RPC.
     |
     |   expires_at defaults to 14 days out. A pass is a snooze, not a ban: rosters and
     |   values move, and a deal that was wrong in October can be the obvious deal in
     |   December)

T454 | completed | Pure trade-suggestion engine
     | files: lib/trade-finder/types.ts, lib/trade-finder/profile.ts,
     |   lib/trade-finder/packages.ts, lib/trade-finder/rank.ts,
     |   lib/trade-finder/explain.ts, lib/trade-finder/engine.ts,
     |   lib/trade-finder/fingerprint.ts
     | depends on: T453
     | verified: yes (no database, no React, no clock, so two runs over the same league
     |   produce the same suggestions in the same order, which is what makes a stored
     |   pass still mean something on the next visit.
     |
     |   SURPLUS is measured by removal, not by bench membership: how many points a
     |   week does the optimal lineup lose if this player leaves? A bench player costs
     |   zero and so does the third back who holds a flex by half a point over the
     |   receiver behind him. The first version used "not in the optimal lineup" and
     |   found nothing on real rosters, because real rosters start their good players.
     |
     |   NEED is measured by addition, through the same optimal fill: what would one
     |   league-average starter at this position add? Counting bodies gets superflex
     |   wrong every time, and there is a test for exactly that.
     |
     |   Goals are CONSTRAINTS, not weights. A reader who picks "Add picks" and is
     |   shown a pickless deal has been ignored, and a weighting that merely prefers
     |   picks hands them exactly that the moment a big lineup upgrade appears. A named
     |   target player overrides the goal, being the more specific request)

T455 | completed | League loader feeding the engine
     | files: lib/trade-finder-data.ts
     | depends on: T454
     | verified: yes (reads only, syncs nothing: an unopened league returns null and
     |   the surface says so. Format comes from resolveLeagueContext like every other
     |   league-view surface, so the global format toggle is ignored and picks fall back
     |   to KTC. Projections are averaged over the weeks Sleeper actually published
     |   inside a six-week window, so a bye does not read as a week the player was
     |   projected to score nothing, and the row count does not grow with the season)

T456 | completed | Signal Check second opinion on the shown suggestion
     | files: lib/trade-finder-grade.ts
     | depends on: T455
     | verified: yes (only the ONE suggestion on screen is graded, not the ranked field:
     |   one batch of value lookups instead of forty. Side "a" is the incoming package
     |   because a Signal Check side holds what that side RECEIVES, matching how
     |   lib/league-signal-check.ts maps a Sleeper trade off `adds`. Never decides
     |   anything and never breaks the page: feature off, no format, or an emptied side
     |   all return null and the card renders without a grade)

T457 | completed | Cross-league walk
     | files: lib/trade-finder-cross-league.ts
     | depends on: T455
     | verified: yes (a request opens at most three leagues, in parallel, and reports
     |   where it stopped. A league that still has deals holds the cursor so the next
     |   press reconsiders it with one fewer candidate; a window that produced nothing
     |   moves past all of it, which is what stops a portfolio of empty leagues looping.
     |   `remaining` counts from the end of the window, not from the cursor, or a reader
     |   who had just searched three would be told there were still twenty-seven to go)

T458 | completed | Server actions + pass list reads and writes
     | files: app/actions/trade-finder.ts, lib/trade-finder-declines.ts
     | depends on: T456, T457
     | verified: yes (nothing in the arguments is trusted as an identity: the user comes
     |   from the session cookie, the rate-limit key is derived server-side, and the
     |   pass row is written with the session's user id under a policy that would reject
     |   any other. League ids ARE taken from the caller and grant nothing, because the
     |   public league page already renders any league's rosters to anyone who asks.
     |   claimSlot fails CLOSED. Declines read and write through the reader's OWN
     |   session client, so the owner policies scope them rather than a filter we
     |   remembered to write)

T459 | completed | Shared UI: one suggestion at a time
     | files: components/trade-finder.tsx, components/trade-finder-card.tsx,
     |   components/trade-finder-panel.tsx
     | depends on: T458
     | verified: yes (one component, two surfaces. Each result is announced in a live
     |   region AND focus moves to the new card's heading, which is what makes "Not
     |   interested" usable without a mouse. No responsive hiding and no truncation
     |   anywhere in these files: every figure on both sides of the deal is present at
     |   every breakpoint, wrapping to a second line rather than being dropped)

T460 | completed | League Trade Finder route + tab
     | files: app/leagues/[league_id]/trade-finder/page.tsx, components/league-tabs.tsx,
     |   app/leagues/[league_id]/page.tsx
     | depends on: T459
     | verified: yes (first suggestion server-rendered so the tab opens on a deal rather
     |   than a button. A cold link with no ?username= cannot know whose team it is, so
     |   it asks once through a team chooser and remembers through the URL: every other
     |   deep-view surface describes the league, but a trade suggestion is advice to one
     |   manager and guessing would be advice to the wrong one)

T461 | completed | Cross-league panel on My Sleeper Leagues
     | files: components/league-quick-links.tsx, app/my-beacon/sleeper-leagues/page.tsx
     | depends on: T459
     | verified: yes (fourth quick link beside Player exposure, Projected finishes, and
     |   Free Agent Finder. Reuses the synced count the exposure read already produced,
     |   so it costs no extra query, and it starts no sync)

T462 | completed | Engine unit tests
     | files: lib/trade-finder/_test-kit.ts, lib/trade-finder/profile.test.ts,
     |   lib/trade-finder/packages.test.ts, lib/trade-finder/rank.test.ts,
     |   lib/trade-finder/engine.test.ts, lib/trade-finder/fingerprint.test.ts
     | depends on: T454
     | verified: yes (70 tests. The engine fixture uses FULL fourteen-man rosters
     |   against seven starting slots, because a seven-man roster has no expendable
     |   pieces by construction and testing against one proves nothing about a real
     |   league. That was not a stylistic choice: the first fixture was seven men, the
     |   engine correctly returned nothing, and chasing it is what produced the
     |   removal-cost definition of surplus in T454)

### Verification summary (Trade Finder)
- npm run typecheck: clean
- npm test: 1167 tests across 90 files, all pass (70 new)
- npm run build: compiles clean, no warnings; /leagues/[league_id]/trade-finder
  registered as a dynamic route at 614 B
- RLS + grants confirmed against prod by querying pg_policies and
  information_schema.role_table_grants. anon has no grants on the new table.
- Exercised against three real synced leagues (12, 12, and 16 teams; 274 to 354
  rostered players) before any UI existed, then end to end in the browser: the
  first suggestion renders, the pass writes a row with a 14-day expiry, and the
  next load opens on a different deal with a different counterparty.

### What real data changed about the design
Three things looked fine in fixtures and were wrong against production leagues.

- The balancing band let the reader's side come in 12% light. Against real
  rosters that is a thousand points of value, and the top suggestion in two of
  three test leagues was a three-for-one nobody would answer. Tightened to 5%
  under and 15% over.
- A long shot still led the ranking at a 0.3 discount, because the reader's side
  of an unfair trade always scores well. Now 0.12, so a refusable deal surfaces
  only once the sensible ones have been passed on.
- Passing produced a near-copy of the same deal, because the engine builds up to
  three packages per target and they score almost identically. Passing now
  demotes every sibling package of that target, so a pass always advances to a
  different player and the alternative prices sit behind it rather than in front.

### Known gaps / follow-ups
- Sleeper's public API is read-only, so a suggestion cannot be pushed into their
  app. The deliverable is a copyable pitch, and the copy says so.
- The player pickers ("player you want", "player you would move") are league-tab
  only. The cross-league panel takes a goal and nothing else.
- Trade values come from the reader's chosen source while the Signal Check grade
  comes from FF Beacon values. Two honest value sets can disagree, and the card
  shows both rather than hiding it.
- News-derived buy-low / sell-high signals and historical trade comps from
  league_transactions are both designed but not built.

### Review pass (Trade Finder)

Three review sub-agents were dispatched per the sub-agent workflow (security,
accessibility, performance). All three ran and then went idle without returning
a report through the message channel, twice each. The findings below are
therefore a FIRST-PARTY audit, not the independent third-party review that was
asked for. Worth re-running before this is treated as reviewed.

T463 | completed | Accessibility fixes from the review pass
     | files: components/trade-finder-card.tsx, components/trade-finder.tsx,
     |   app/leagues/[league_id]/trade-finder/page.tsx
     | depends on: T459
     | verified: yes (four defects, all found by reading rather than by tooling.
     |
     |   aria-label on a <dd> does not reliably announce. A dd maps to the
     |   `definition` role, which does not support naming from author, so several
     |   screen readers ignore the attribute and read the bare "+4.6/wk" with no
     |   unit and no subject. Every impact figure on the card was affected. The
     |   spoken sentence is now a real sr-only span with the visible figure in an
     |   aria-hidden sibling, so the number is announced once, in full.
     |
     |   Two to three seconds of silence after pressing a button is
     |   indistinguishable from a button that did nothing. The live region now
     |   says "Searching for a trade" at the START of the search, not only at
     |   the end.
     |
     |   The result announcement used to read the whole headline, and then focus
     |   moved to the card whose heading IS the headline, so it was said twice.
     |   The announcement is now short and the card carries the detail.
     |
     |   outline-none on the focus target removed the ring with no replacement,
     |   against the project rule. It carries a focus-visible ring now. The
     |   result is also a labelled <section> tied to the card heading, and the
     |   working column has an h2, so the card's h3 no longer skips a level on
     |   the page. Inside the SidePanel the panel title is already an h2, so the
     |   same h3 is correct there without changing anything)

T464 | completed | Performance fixes from the review pass
     | files: app/leagues/[league_id]/trade-finder/page.tsx,
     |   app/actions/trade-finder.ts, lib/trade-finder-data.ts,
     |   lib/trade-finder-cross-league.ts
     | depends on: T460
     | verified: yes (the league route used to block its entire render on
     |   loadTradeFinderLeague, measured at 2.1 to 2.5s, so the tabs and the
     |   league identity card arrived at the same moment as the deal. The load,
     |   the engine run, and the Signal Check grade now sit in an async child
     |   behind Suspense, matching how the Overview tab streams its rankings.
     |   Header and tabs paint immediately; observed first paint went from
     |   roughly 20 seconds on a cold compile to about 3.
     |
     |   Pick prices were being fetched after the rosters even though they need
     |   only the format, so they moved into the first parallel batch. The
     |   cross-league window loads its three leagues with Promise.all rather than
     |   one after another, which is the difference between about 2.5s and about
     |   7s per press.
     |
     |   Rate limits were sized against measured cost rather than picked round.
     |   One league search is about 2.3s of database work, so 12 a minute is
     |   about 28s of database time per actor per minute; the portfolio call
     |   opens up to three leagues, so 6 a minute is about 41s. Down from 20 and
     |   10, which allowed 46s and 69s respectively on a PUBLIC endpoint.
     |
     |   Engine cost is bounded and was left alone: about N+6 lineup fills per
     |   team for the profiles and two per candidate deal, which measures at 25
     |   to 35ms for a 16-team league. The remaining 1.2s of the load is
     |   loadLeagueTeamCards, shared with the Overview and Teams tabs, whose
     |   resolvePlayers builds a PostgREST .or() filter with two terms per
     |   player. That is pre-existing and was not touched here)

T465 | completed | Acceptance-band fix for rebuilding teams
     | files: lib/trade-finder/rank.ts, lib/trade-finder/rank.test.ts
     | depends on: T454
     | verified: yes (found by looking at a real league, not by a test. The
     |   both-axes-loss rule added earlier said that a team losing lineup points
     |   AND value has nothing to say yes to. True for a contender, wrong for a
     |   rebuilder: sending a 27-year-old back away for a pick and a 22-year-old
     |   costs points on Sunday, and that is not a side effect of the deal, it IS
     |   the deal. The engine was labelling the most standard trade in dynasty
     |   football a long shot.
     |
     |   The lineup penalty now applies only to teams whose timeline is this
     |   season. The suggestion that exposed it, a 2028 2nd plus a 22-year-old TE
     |   for Jonathan Taylor at a 1% value gap, went from "Long shot" to
     |   "Likely", which is what any manager in that league would call it)

### What the first-party review found, by category
- Security: no findings. Every client-supplied string is pattern-validated
  before it reaches a query, arrays are capped, the rate limiter fails closed,
  the actor key is derived server-side, the decline row is written with the
  session's user id under a policy that would reject any other, and no
  dangerouslySetInnerHTML exists anywhere in the feature. Player and team names
  come from Sleeper and render as React children, so they are escaped.
  Noted but not changed: lib/league-view-data.ts resolvePlayers builds an .or()
  filter string from ids without validating them. Those ids come from our own
  rosters rows rather than from a caller, and the file is pre-existing.
- Accessibility: four findings, all fixed (T463).
- Performance: four findings, all fixed (T464), plus one pre-existing shared
  cost documented and left alone.

### Copy, styling, and pitch pass (Trade Finder)

T466 | completed | Condense the instructional copy
     | files: app/leagues/[league_id]/trade-finder/page.tsx,
     |   components/trade-finder.tsx, components/trade-finder-panel.tsx
     | depends on: T460
     | verified: yes (the tab was text-heavy in the places that explain the tool
     |   rather than the trade. Cut roughly in half: the intro strip lost two of
     |   its three sentences, the "Where the numbers come from" rail became three
     |   term-and-source lines plus one caveat instead of four full sentences,
     |   the three field hints went to five words each, and every empty state and
     |   footnote was shortened.
     |
     |   What was deliberately NOT touched: whyYou, whyThem, the caveat list, and
     |   the Signal Check explanation. That copy is the product. The instructions
     |   around it are what a reader passes on every visit and stops reading by
     |   the second one)

T467 | completed | Restyle the suggested trade
     | files: components/trade-finder-card.tsx
     | depends on: T459
     | verified: yes (the deal is the point of the page and used to be a flat
     |   card indistinguishable from the panels around it. It now carries the
     |   treatment this site reserves for its primary surfaces: an elevated panel
     |   with a beacon hairline along the top edge and a purple corner glow, the
     |   same language as the tab bar and the On The Clock cockpit.
     |
     |   Each player and pick sits in its own raised container rather than being
     |   a row in a list, because a trade is a set of discrete things and running
     |   them together makes a three-for-one read as a paragraph. The two sides
     |   are tinted apart, cyan for what arrives and purple for what leaves, with
     |   the heading still saying which is which because a tint is not a label.
     |
     |   Player photos are rounded rectangles rather than circles. A Sleeper
     |   headshot is a head-and-shoulders crop and a circle cuts the shoulders
     |   off. Done through the existing `rounded={false}` on PlayerHeadshot,
     |   which is the site's own rounded-card token, rather than a one-off class
     |   fighting the component's own shape)

T468 | completed | Rewrite the pitch as a message to the other manager
     | files: lib/trade-finder/explain.ts, lib/trade-finder/types.ts,
     |   lib/trade-finder/engine.ts, components/trade-finder.tsx,
     |   components/trade-finder-card.tsx, lib/trade-finder/explain.test.ts
     | depends on: T454
     | verified: yes (Copy the pitch used to hand over the whole card: the
     |   headline, then why it helps the sender, then why it helps them, all in
     |   the third person. Pasted into a league chat it read as notes about
     |   somebody rather than a message to them.
     |
     |   `buildPitch` writes to the receiving manager. It opens as a question
     |   ("What do you think of me sending you X, and you sending back Y?")
     |   because that is an offer to talk, where "I'll give you X for Y" is a
     |   demand that invites a yes or a no.
     |
     |   It carries NOTHING about what the sender gains. That is the whole point:
     |   the other manager does not care, and telling them hands over the reason
     |   to refuse. Everything after the opener is about their roster, drawn from
     |   their own direction, and when there is nothing true to say the message
     |   is the offer on its own rather than an invented benefit.
     |
     |   Value is described as a share rather than in points: 91 points down on a
     |   6,500-point trade is a rounding error and the first version said nothing
     |   at all, because 91 is more than 1. When they ARE visibly behind it says
     |   nothing, since apologising for the shortfall inside the message that
     |   proposes the trade argues against the trade.
     |
     |   The message is also previewable on the card behind a collapsed details
     |   element, which costs one line and is what makes the feature usable when
     |   the clipboard is blocked. 11 tests, including one asserting the pitch
     |   never contains the sender's own benefit and one asserting it never reads
     |   as a hard sell)

### Verification summary (copy, styling, pitch)
- npm run typecheck: clean
- npm test: 1178 tests across 91 files, all pass (11 new)
- npm run build: compiles clean, no warnings
- No browser testing this pass, at the owner's request.

## Consolidation-aware trade quality (Signal Check + Trade Finder)

T469 | completed | Shared consolidation quality module
     | files: lib/trade-quality.ts, lib/trade-quality.test.ts
     | depends on: T454, T456
     | verified: yes (Pure module, no DB, no React. Scores every asset a second
     |   time on a curve that rises faster than value, so one premium player is
     |   not interchangeable with three depth pieces that happen to add up.
     |
     |   Q(p) = p x [base + scale x (p/G)^1.3 + peak x (p/(1.05 x H))^6] where H
     |   is the trade's own best asset and G is the pool ceiling. On top of that,
     |   any piece worth under half of H is a package piece, and the 2nd, 3rd and
     |   4th of those are multiplied by 0.85, 0.70 and 0.60.
     |
     |   solveTradeBalance bisects for the value of the extra asset the trailing
     |   side would need to draw level, recomputing the WHOLE comparison at each
     |   step because a candidate can change which pieces count as package pieces
     |   and can move H itself. That amount becomes the visible Value adjustment.
     |
     |   Two deliberate refusals. One-for-ones get no adjustment, because the
     |   value gap between two single players is the whole story already and a
     |   premium on top would count it twice (minAssetsForAdjustment). And an
     |   adjustment below the noise floor is dropped entirely rather than applied
     |   invisibly, so a displayed total always equals the assets above it.
     |
     |   Stored values are never touched: everything is computed inside one trade
     |   and discarded. 30 tests, including symmetry (the same trade from the
     |   other seat returns the same numbers), a balance check (adding the solved
     |   asset really does level the sides), the cap, and input immutability)

T470 | completed | Consolidation replaces pile-on inside Signal Check
     | files: lib/signal-check/types.ts, lib/signal-check/settings.ts,
     |   lib/signal-check/trade-shape.ts, lib/signal-check/calibration.ts,
     |   lib/signal-check/pipeline.ts, lib/signal-check/confidence.ts,
     |   lib/signal-check/explanation.ts, lib/signal-check/values.ts,
     |   lib/signal-check/versions.ts, lib/signal-check/trade-shape.test.ts,
     |   app/tools/signal-check/actions.ts,
     |   app/tools/signal-check/import-actions.ts,
     |   app/admin/signal-check/regression-actions.ts,
     |   lib/league-signal-check.ts, lib/trade-finder-grade.ts
     | depends on: T469
     | verified: yes (The quality pass runs as step 3 of the trade-shape phase,
     |   after the side rules and before shape detection. Pile-on is left in the
     |   code and switched off by default: both discount the tail of a package,
     |   so running the pair charges it twice, and a test asserts exactly that.
     |
     |   Side totals are NOT rewritten. The credit lands in a new
     |   consolidationAdjustment on AnalyzedSide and the sum goes in
     |   effectiveTotal, so a reader can see the plain arithmetic next to the
     |   number that changed the answer. computeVerdict compares the effective
     |   totals; shape detection reads them too, so the shape and the verdict can
     |   never disagree about whether a trade is close.
     |
     |   roster_clog was keyed off pileOnFired, which would have gone silent the
     |   moment pile-on was turned off. It is now keyed off whichever mechanism
     |   found the depth: pile-on firing, or the quality pass discounting two or
     |   more pieces on a side.
     |
     |   buildValueResolver gained poolMax, one indexed top-of-pool row per
     |   format, threaded through all five runPipeline callers. Null is handled:
     |   the curve falls back to the trade's own best asset.
     |
     |   Confidence takes a small hit when a verdict leans on a modelled
     |   adjustment and a larger one when the solver had to cap, because those
     |   are the two cases where the number is least certain. The explanation
     |   drops its "receives the strongest individual asset" sentence when the
     |   consolidation sentence is present, which says the same thing better.
     |
     |   Both version pins moved to 1.1.0. Saved analyses replay from
     |   public_payload and never recompute, so existing permalinks are untouched)

T471 | completed | Quality settings seed + pile-on default flip
     | files: supabase/migrations/0174_signal_check_quality_settings.sql
     | depends on: T470
     | verified: yes (15 rows under a new signal_check_quality category, applied
     |   to prod via MCP and verified back out of pg. Every coefficient, the 50%
     |   package threshold, the multiplier list, the noise floor and the solver
     |   ceiling are admin-editable, so the model can be recalibrated against the
     |   regression set without a deploy. The Signal Check settings page picks
     |   them up with no new UI: it already queries category LIKE
     |   'signal_check%'.
     |
     |   The same migration flips signal_check_pileon_enabled to false and
     |   rewrites its description to say why. No schema change, so no RLS work
     |   and no types regen: beacon_settings is service-role only and its columns
     |   did not move)

T472 | completed | Value adjustment as its own line item
     | files: app/tools/signal-check/value-adjustment-row.tsx,
     |   app/tools/signal-check/trade-result.tsx,
     |   app/tools/signal-check/v/[shareId]/page.tsx,
     |   lib/signal-check/builder-view.ts, lib/signal-check/freeze.ts
     | depends on: T470
     | verified: yes (The credit sits inside the side's asset list, in the same
     |   row shape as a player, so the total above it is the sum of everything
     |   below including this. A footnote elsewhere on the page would not answer
     |   the question a reader actually has, which is where the difference came
     |   from.
     |
     |   Points when the admin shows raw values, a share of the trade when they
     |   do not. The percentage carries the same meaning without exposing the
     |   value scale, so the line stays honest at either setting rather than
     |   vanishing at the default one.
     |
     |   The row explains itself in visible text ("Credit for holding the best
     |   asset in the trade") rather than through an aria-label duplicating what
     |   is already on screen. The plus badge is aria-hidden. Same row shape at
     |   every breakpoint, so nothing is hidden on mobile.
     |
     |   Renders on the share page from public_payload too, and tolerates a
     |   payload frozen before the field existed: the fields are checked for a
     |   finite number rather than for null, so an older share link renders
     |   exactly as it always did)

T473 | completed | Trade Finder balances packages on quality, not addition
     | files: lib/trade-finder/packages.ts, lib/trade-finder/types.ts,
     |   lib/trade-finder-data.ts, lib/trade-finder-cross-league.ts,
     |   app/actions/trade-finder.ts, lib/trade-finder/packages.test.ts
     | depends on: T469
     | verified: yes (This is the change that stops the bad offers, because the
     |   bad offers were built here. balancePackages accepted any combination
     |   whose raw values summed to between 95% and 115% of the target, and
     |   nothing in that test could tell three bench pieces from one starter.
     |
     |   A candidate package now has to clear the quality band as well: its
     |   quality must land between 0.92 and 1.18 of what the reader is asking
     |   for. The raw band widens to a search bound (+60%) at the same time,
     |   which is not a loosening. Consolidation genuinely costs a raw premium of
     |   roughly a third on a two-for-one, so keeping the old 15% ceiling
     |   alongside the quality test would have rejected every package that pays
     |   one and reduced the feature to suggesting one-for-ones.
     |
     |   incomingPairs takes the same widened bound, or the add-depth goal would
     |   build pairs the outgoing gate then refuses, and that goal would return
     |   nothing at all.
     |
     |   The config comes from the same beacon_settings rows Signal Check reads,
     |   loaded once per press through the admin client, so the suggestion and
     |   the grade printed under it can never disagree for a reason no reader
     |   could discover. A failed read falls back to the published defaults
     |   rather than taking the feature down. poolMax is one indexed row per
     |   league, in the reader's own source, added to the existing parallel read
     |   so it costs no extra round trip)

T474 | completed | Acceptance band reads quality, not raw value
     | files: lib/trade-finder/rank.ts, lib/trade-finder/engine.ts,
     |   lib/trade-finder/types.ts, lib/trade-finder/rank.test.ts
     | depends on: T473
     | verified: yes (acceptanceOf decided "is the other manager losing value"
     |   from the raw delta, so a three-for-one that balanced on paper came back
     |   Likely and scored at full weight. It now reads the quality ratio, which
     |   is what the counterparty RECEIVES over what they give, and is the same
     |   number from either seat so no sign flip is needed.
     |
     |   The same deal now lands Long shot, which carries a 0.12 multiplier and
     |   removes it from the top slot without deleting it: sometimes the honest
     |   answer really is that you would have to overpay.
     |
     |   qualityGapOf expresses the gap as a share of the larger side, exactly
     |   like valueGapOf, so EVEN_GAP and LOPSIDED_GAP keep meaning what they
     |   meant. The raw path is still there and still tested, for any caller that
     |   has no quality model to hand.
     |
     |   qualityRatio rides along on every suggestion. valueGap stays raw,
     |   because the pitch quotes it to the other manager and that message should
     |   describe the values both people can look up)

T475 | completed | Stop the same player headlining every suggestion
     | files: lib/trade-finder/engine.ts, lib/trade-finder/engine.test.ts
     | depends on: T454
     | verified: yes (spreadByTarget already kept consecutive suggestions from
     |   being for the same incoming player. Nothing did the same for the paying
     |   end, and that end has a structural cause: the reader's currency is one
     |   pool sorted cheapest first, and the balancer prefers the smallest
     |   package that clears the target, so the same two or three assets cleared
     |   the band for nearly every target in the league.
     |
     |   spreadByPayment walks the ranked list and, when the next deal pays with
     |   the same headline asset the last one did, takes the first later deal
     |   that does not. Greedy and stable: nothing is dropped and nothing is
     |   reordered where there is no clash to fix, so the score ordering survives
     |   and two runs over the same league still return the same order, which is
     |   what makes a stored pass still mean something on the next visit.
     |
     |   The quality gate from T473 helps here on its own: cheap assets now fail
     |   the band more often, so the pool of viable currency is wider than it was)

T476 | completed | Review pass: copy accuracy, coefficient guards, client reuse
     | files: lib/signal-check/settings.ts, lib/signal-check/explanation.ts,
     |   lib/signal-check/pipeline.ts, lib/trade-quality.ts,
     |   app/tools/signal-check/value-adjustment-row.tsx,
     |   app/actions/trade-finder.ts, lib/signal-check/freeze.test.ts,
     |   supabase/migrations/0174_signal_check_quality_settings.sql
     | depends on: T472, T475
     | verified: yes (Three findings from the self-review, all fixed.
     |
     |   COPY, twice. Both the explanation template and the adjustment row's
     |   helper line asserted things that are usually true and not always. The
     |   template opened "Side {side} gives up more total value", which is false
     |   whenever two sides start level and consolidation alone separates them,
     |   and the row said "Credit for holding the best asset in the trade", which
     |   is false in the case where a side wins on quality without holding the
     |   single biggest piece. Both now describe concentration, which is what the
     |   model actually measures and is true on every trade that earns a credit.
     |   The prod row was updated to match the migration file.
     |
     |   The explanation's "receives the strongest individual asset" sentence is
     |   no longer suppressed when a credit applies. It was suppressed because
     |   the old template said the same thing; the new one does not, and that
     |   sentence is measured from real values rather than assumed.
     |
     |   COEFFICIENT GUARDS. Every weight and exponent is admin-editable and the
     |   ratios are all in (0,1], where a negative exponent means "get bigger as
     |   the asset gets smaller" and inverts the model on a typo. Exponents floor
     |   at zero, weights floor at zero, and a non-finite weight returns zero. A
     |   bad setting can now make the curve dull; it cannot make it lie.
     |
     |   ADMIN CLIENT REUSE. Both finder actions built two service-role clients
     |   and ran two beacon_settings reads per press, one for the quality config
     |   and one for the grade. One client, passed to both.
     |
     |   Three new freeze tests: the adjustment is withheld in points when raw
     |   values are hidden while the percentage survives, the header total
     |   reconciles against the assets plus the credit when they are shown, and a
     |   trade that earned no credit carries no adjustment fields at all)

### Verification summary (consolidation quality)
- npx tsc --noEmit: clean
- npm test: 1233 tests across 92 files, all pass (55 new)
- npm run build: compiles clean in 14.3s, no warnings
- Migration 0174 applied to prod via MCP and read back from pg_catalog; 15 rows
  under signal_check_quality, signal_check_pileon_enabled now false. No schema
  change, so no RLS work and no database.types.ts regeneration.
- npm audit --omit=dev: 3 high, all pre-existing transitive dependencies of Next
  (next DoS, postcss XSS, sharp/libvips). None introduced here, none reachable
  from this change; package.json is untouched. Fixing them means a Next upgrade
  and should be its own task.
- Calibration run against the seven reference shapes (see handoff.md).
- No browser testing this pass.

## Trade Finder navigation, bookmarks, and a search button that means what it says

T477 | completed | Grade a whole shortlist for the cost of grading one
     | files: lib/trade-finder-grade.ts
     | depends on: T456
     | verified: yes (The reader can now page through the ranked field, so every
     |   deal in it needs a grade rather than only the one that came first. The
     |   obvious way, a gradeSuggestion call per suggestion, would be twelve
     |   rounds of settings, ruleset, format, player, value and pick lookups, and
     |   the note at the top of that file about one batch versus forty would have
     |   been exactly right.
     |
     |   gradeSuggestions shares the lookups instead. A league's suggestions come
     |   off the same rosters, so the union of their assets is barely larger than
     |   any single deal's: one synthetic AnalysisInput holding every asset builds
     |   one resolver that answers all twelve. The pipeline is pure, so the runs
     |   after it touch no database at all.
     |
     |   Errors are caught per suggestion rather than per batch: one deal carrying
     |   an asset with no value row must not cost the other eleven their grades.
     |   gradeSuggestion is now a one-element call through the same path)

T478 | completed | League search returns a window of the ranking
     | files: app/actions/trade-finder.ts,
     |   app/leagues/[league_id]/trade-finder/page.tsx
     | depends on: T477
     | verified: yes (The engine ranked forty and the action returned
     |   suggestions[0], reporting the rest as a count. That left the surface with
     |   no way forward except Not interested. It now returns twelve with their
     |   grades and the reader's saved keys, and reports anything past the window
     |   honestly as beyondWindow rather than pretending it away. Twelve is a
     |   transport decision: the engine still ranks forty.
     |
     |   The league page's server-rendered first paint had a real bug, found while
     |   wiring this: its findTrades call never passed the quality config added in
     |   T473, so the tab opened on a deal assembled by plain addition while every
     |   later search used the consolidation gate. The first suggestion was one
     |   its own Search button could not reproduce. It now loads the same admin
     |   settings and passes the same poolMax)

T479 | completed | Cross-league walk returns a window too
     | files: lib/trade-finder-cross-league.ts
     | depends on: T478
     | verified: yes (Was returning the single best deal from a three-league
     |   window. Now takes up to four per league, merges on score, and spreads so
     |   consecutive deals come from different rooms before returning twelve.
     |   Without the spread one strong league supplies the first four and a reader
     |   pages through a portfolio feature that only ever talks about one league.
     |   The cursor logic is untouched, so pressing Search still walks the
     |   portfolio exactly as it did)

T480 | completed | Migration 0175: trade_suggestion_saves
     | files: supabase/migrations/0175_trade_suggestion_saves.sql,
     |   lib/database.types.ts
     | depends on: T473
     | verified: yes (RLS VERIFIED LIVE against prod inside a rolled-back
     |   transaction, zero persistence. anon: permission denied at the table grant
     |   level, which is stronger than a policy miss. Authenticated user A with
     |   two rows present: sees 1, deletes 0 of user B's, updates 0 of user B's,
     |   and an insert naming user B as owner is refused by WITH CHECK with
     |   nothing written. Five policies confirmed in pg_policy with the right
     |   roles and expressions.
     |
     |   The table stores the whole suggestion, not just its fingerprint like the
     |   pass list does. A pass only has to answer "have I seen this"; a bookmark
     |   has to answer "what was it", and the engine cannot be asked again once
     |   rosters and values have moved. A bookmark that silently became a
     |   different trade would be worse than no bookmark, so it renders from the
     |   snapshot and is never recomputed. Same contract as a frozen Signal Check
     |   permalink.
     |
     |   No expires_at, unlike declines. A pass is a snooze; deleting a bookmark
     |   after a fortnight would be a bug rather than a policy. Types regenerated
     |   via MCP and prettier-formatted: 33 added lines, nothing else moved)

T481 | completed | lib/trade-finder-saves.ts, the bookmark boundary
     | files: lib/trade-finder-saves.ts, lib/trade-finder-saves.test.ts
     | depends on: T480
     | verified: yes (The client posts the snapshot and a strict bounded Zod
     |   schema decides whether it is storable. The alternative, posting a
     |   fingerprint and re-running the whole search to find the deal it names, is
     |   about two and a half seconds of database work to record a bookmark. The
     |   row is only ever read back by the person who wrote it, so the worst a
     |   forged one can do is show its author a trade they invented: the same
     |   argument migration 0173 already makes for a forged pass. The schema is
     |   there to stop the column becoming general storage, not to prove
     |   provenance, and the comments say so rather than implying more.
     |
     |   .strict() throughout, so an unknown key is a rejection rather than
     |   something ignored. Assets capped at six a side, free text capped, numbers
     |   required finite, seasons and rounds bounded, the fingerprint checked
     |   against the engine's own pattern. Rows are parsed on the way OUT as well,
     |   so a bookmark written by an older shape of the engine drops out of the
     |   list rather than rendering as half a card.
     |
     |   16 tests, every one of them a payload the column must refuse. Zod 4's
     |   .uuid() turned out to enforce RFC-4122 version bits; player ids are all
     |   v4 today so it would have passed, but rejecting a bookmark over a version
     |   nibble is a strange way to fail, so it validates the shape instead,
     |   matching the pattern the finder's own actions already use)

T482 | completed | Save, remove, and list server actions
     | files: app/actions/trade-finder.ts
     | depends on: T481
     | verified: yes (All three require a session and say so rather than failing
     |   quietly, because a save button that does nothing is the exact problem
     |   this change set out to remove from the other buttons. user_id is stamped
     |   from the session, never from the request, under a policy that would
     |   reject any other value. The per-user ceiling is checked before insert and
     |   the failure is named, including the fact that it is a limit)

T483 | completed | Previous, Next, and a position readout
     | files: components/trade-finder.tsx
     | depends on: T478
     | verified: yes (The shortlist lives in component state, so the arrows are
     |   pure index changes with no round trip, no rate-limit pressure, and no
     |   two-second wait to see a deal the server already computed and sent.
     |
     |   "Trade 3 of 12" is visible text rather than an aria-only string: a
     |   sighted reader needs to know there are nine more just as much as anyone.
     |   Every move announces in the existing polite live region AND moves focus
     |   to the card heading, which is what makes the arrows usable without a
     |   mouse. Previous and Next disable at the ends at 50% opacity rather than
     |   disappearing, so the shape of the control does not move under the cursor.
     |
     |   Not interested no longer triggers a re-search. It splices the deal out of
     |   what is already held and keeps the reader's place in the ranking, so a
     |   pass is instant instead of a 2.3 second wait that sent them back to the
     |   top. The database write still happens, and still happens whether or not
     |   the local list agrees, so a failed write cannot strand the reader on a
     |   deal they just refused)

T484 | completed | Separate searching from navigating
     | files: components/trade-finder.tsx, components/trade-finder-panel.tsx,
     |   app/leagues/[league_id]/trade-finder/page.tsx
     | depends on: T483
     | verified: yes (The submit button read "Find another trade" and re-ran a
     |   deterministic search with unchanged filters and an unchanged pass list,
     |   which returned the identical trade. It looked like navigation and it was
     |   a no-op, worst of all on the league tab, which server-renders a deal on
     |   first paint so the page opened with a suggestion visible and a button
     |   promising another one.
     |
     |   It now reads "Search with these settings", sits with the filters that
     |   shape it, and carries a line saying the arrows below are what move
     |   between results. Changing the goal resets the portfolio cursor, because a
     |   new goal is a new question and continuing the walk would leave every
     |   league already visited unexamined under it. Surrounding copy on both
     |   surfaces was rewritten to describe stepping through rather than passing)

T485 | completed | Saved tab, with a login gate that shows the feature
     | files: components/trade-finder.tsx
     | depends on: T482, T483
     | verified: yes (A two-button toggle rather than a tablist: a tablist
     |   promises arrow-key movement between tabs and a matching set of tabpanels,
     |   and this is two toggles over one region, so aria-pressed says what is
     |   actually true.
     |
     |   Saved deals render through the same card from their snapshot, with the
     |   save date through formatEastern and a line saying values are as they were
     |   then. Save does NOT move focus or advance, because saving is not
     |   navigation and stealing the cursor there would send a keyboard reader
     |   somewhere they did not ask to go.
     |
     |   Signed out, the reader sees "Sign in to bookmark this trade" as a real
     |   link to /login in the action row, and "Sign in to save trades" where the
     |   Saved tab would be. Both are links rather than disabled text, so the
     |   feature is discoverable and the gate is one click rather than a dead end)

T486 | completed | Fix the value ceiling hidden in the currency pool
     | files: lib/trade-finder/packages.ts, lib/trade-finder/packages.test.ts
     | depends on: T473
     | verified: yes (givablePool sorts ascending, because the balancing search
     |   wants to try the cheapest package that clears the target first, and then
     |   took the first fourteen. That keeps the fourteen CHEAPEST assets and
     |   silently discards everything above them, so on a deep dynasty roster the
     |   engine could not offer a good player because the good players were never
     |   in the pool. The comment explained the sort correctly and the slice then
     |   acted as a value ceiling nobody intended.
     |
     |   The cut now takes eight from the cheap end and six from the expensive
     |   one, preserving ascending order because the search depends on it. A test
     |   builds a roster with a 7,000-point stash behind sixteen bench pieces and
     |   asserts it survives into the pool)

T487 | completed | Stop one team owning the shortlist
     | files: lib/trade-finder/engine.ts, lib/trade-finder/engine.test.ts
     | depends on: T483
     | verified: yes (spreadByTarget and spreadByPayment vary the players. Nothing
     |   varied the team, and a league usually has one manager whose roster fits
     |   the reader's better than anyone else's, so their deals could hold most of
     |   the ranking. Invisible while the surface showed one suggestion; with
     |   arrows on the card it is eight consecutive offers to the same person.
     |
     |   Same greedy walk as the other two, running last so the player spreads
     |   settle first and this only breaks ties they left behind. Tested for the
     |   spread and for dropping nothing, and the determinism test still passes,
     |   which is what keeps a stored pass meaningful on the next visit)

### Verification summary (navigation, bookmarks, engine fixes)
- npx tsc --noEmit: clean
- npm test: 1254 tests across 93 files, all pass (21 new)
- npm run build: compiles clean in 13.9s, no warnings
- Migration 0175 applied to prod via MCP. RLS verified live inside a rolled-back
  transaction: anon denied at the grant level, owner scoping confirmed on select,
  update, delete, and a cross-user insert. Types regenerated and formatted.
- npm audit --omit=dev: unchanged from the previous pass. 3 high, all pre-existing
  transitive dependencies of Next. package.json untouched.
- No browser testing this pass; no dev server left running.

## Draft pick modifiers in manual signals (FF Beacon values admin)

T488 | completed | Pick signals cover a whole round, and the engine reads them
     | files: supabase/migrations/0176_beacon_manual_pick_signals.sql,
     |   lib/beacon/pick-slots.ts, lib/beacon/signals/manual.ts,
     |   lib/beacon/signals/manual.test.ts, lib/calculate-beacon-values.ts,
     |   lib/beacon-admin.ts, app/admin/beacon/actions.ts,
     |   app/admin/beacon/manual/page.tsx, components/admin/manual-composer.tsx,
     |   components/admin/manual-signals-list.tsx
     | depends on: T-beacon-manual (migration 0040), T-beacon-pick-multiplier
     |   (migration 0116)
     | verified: yes (The composer has offered a Draft pick target since 0040 and
     |   the table has stored the rows, but nothing on the read side ever looked
     |   at target='pick'. Three signals sat inactive in the table having never
     |   moved a value. So this is two jobs: make the signal reach the engine,
     |   and make one submission cover a round.
     |
     |   Migration 0176 lets pick_position be null, meaning every slot in that
     |   season and round, and requires a season on a pick signal. It also stops
     |   a player signal from carrying stray pick coordinates and a pick signal
     |   from carrying a player_id; both were possible before and neither means
     |   anything.
     |
     |   pickOverridesFor matches on season and round exactly, on slot unless the
     |   signal names none, and on format unless the signal names none. Decay
     |   works the same as it does for players. silent is dropped on the way
     |   through: draft_pick_values has no formula_offset column and picks feed no
     |   trend chips, so there is nothing for a silent pick change to hide from.
     |
     |   In the engine the overrides land in step 7, after the global
     |   pick_value_multiplier and after the derived boards inherit their picks.
     |   That order matters: applying before the inherit copy would push a signal
     |   scoped to one derived board onto its baseline instead. Each adjusted row
     |   records pre_manual_value and the overrides in metadata, and the run notes
     |   count the rows that moved.
     |
     |   Slots are checkboxes, all three checked by default. All three collapses
     |   to a single null row, so a whole round is one entry to review and one
     |   Deactivate to undo; a subset writes one row per slot so they can come off
     |   independently. Season and round are dropdowns built from the pick values
     |   actually published (loadPickCoordinates reads one narrow slice, since
     |   PostgREST has no DISTINCT and the table holds every snapshot), and the
     |   pick target disables itself with an explanation when no picks exist yet.
     |   Scope for a pick signal lists only dynasty boards, because those are the
     |   only ones that have picks.
     |
     |   Verified against production data read-only: a 0.9 signal on 2027 round 3
     |   with no slot named resolved to 15 rows, three slots across all five
     |   dynasty boards, round 2 untouched. The temporary signal was deleted)

### Verification summary (draft pick modifiers)
- npx tsc --noEmit: clean
- npm test: 1265 tests across 94 files, all pass (11 new in
  lib/beacon/signals/manual.test.ts)
- npm run build: compiles clean in 9.7s, no warnings
- Migration 0176 applied to prod via MCP. Constraints confirmed in pg_constraint
  after the change; the service-role-only policy from 0040 is intact and no new
  grants were added. Generated types diffed byte-for-byte against
  lib/database.types.ts: identical, since only constraints and comments changed.
- No browser testing this pass; no dev server left running.

## Trade Finder: variety on the paying side

T489 | completed | The search varies what the reader sends, and covers every asset
     | files: lib/trade-finder/packages.ts, lib/trade-finder/engine.ts,
     |   lib/trade-finder/packages.test.ts, lib/trade-finder/engine.test.ts
     | depends on: T477, T478, T487
     | verified: yes (Reported by users and reproduced against four production
     |   leagues before anything was changed: asked for twelve ideas, the finder
     |   returned twelve different players coming BACK for the same two or three
     |   going OUT. Foxtrot Squad was the worst, three distinct payments across
     |   twelve deals with Stefon Diggs in seven of them, and the reader held
     |   fourteen tradeable assets of which five ever headlined anything.
     |
     |   Three causes, two of them structural.
     |
     |   The search walked one ascending pool and took the first three packages
     |   that fit, from the same end, for every target in the league. Whichever
     |   asset sat at the price point most of the league is priced at became the
     |   answer to every question. It now gathers up to twenty-four candidates
     |   and chooses between them on a running tally of what has already been
     |   offered, and the three it returns lead with different assets wherever
     |   the roster allows. Fewer pieces and closer to the target still win among
     |   equally fresh leads, so a clean one-for-one is still preferred.
     |
     |   Nothing could offer an asset the currency pool would not spend, and that
     |   pool is deliberately narrow: it is what a roster can afford to LOSE.
     |   A manager asking what their best player is worth got silence. Every
     |   unmentioned asset now anchors its own search (anchorCandidates), with
     |   the return built around it instead of it being built around somebody
     |   else, and the other team's comparable players come on the table for that
     |   search only (acquirablePool comparableTo). That is not the "give me your
     |   best player" failure mode the pool exists to prevent: that shape is
     |   spare parts for a star, this is an equal piece for an equal piece.
     |
     |   The quality gate had to learn which seat it was sitting in. The coverage
     |   search fixes the outgoing side and builds the incoming one, so reading
     |   the band the old way scored a return worth 15% more as the reader
     |   underpaying by 13%: the same trade described backwards. QualityGate
     |   grew a `reversed` flag so one orientation holds everywhere and a quality
     |   ratio means the same thing on every suggestion.
     |
     |   Third, three reordering passes ran in sequence and the last undid the
     |   second: the team spread pulled back deals the player spread had just
     |   separated, which is why production showed three consecutive Jake
     |   Ferguson offers in a pipeline containing code whose whole job was
     |   stopping that. They are now one walk with one key: never a repeat of the
     |   deal directly before it on either axis, then whichever repeats least of
     |   everything shown so far, then the better score. Freshness beats a better
     |   deal on purpose, per the owner's call that variety outranks consistent
     |   quality because the reader is here for ideas to build on. The opener is
     |   exempt and is still the best deal in the league.
     |
     |   A passed deal counts against the tallies exactly as a shown one does, so
     |   the search keeps the path it was on and the queue advances instead of
     |   rebuilding itself around the gap. Measured on production: nine or ten of
     |   the next eleven carry over per pass.
     |
     |   Fairness was NOT loosened to buy any of this. Every emitted suggestion
     |   still lands inside the same consolidation band, measured at 0.920 to
     |   1.180 across all six leagues tested)

### Verification summary (Trade Finder variety)

Measured with a throwaway script against six production leagues, roster 1,
Best available, before and after. Deleted after use; nothing added to scripts/.

| League | Distinct payments in the 12 shown | Distinct partners | Back-to-back repeats |
|---|---|---|---|
| Foxtrot Squad (16) | 3 to 12 | 6 to 12 | 2 to 0 |
| Chicken Bacon Ranch (14) | 5 to 12 | 7 to 12 | 3 to 0 |
| DynastyLeague (12) | 7 to 12 | 4 to 8 | 1 to 0 |
| BoomBust 8 (12) | 7 to 12 | 5 to 11 | 2 to 0 |

- Coverage: 22/22, 23/28, 25/28, 25/30, 26/28 and 30/40 tradeable assets now
  appear in at least one suggestion. The ones that never do are the bottom of a
  roster by value (Will Levis at 73, Xavier Restrepo at 46); COVERAGE_ANCHORS
  takes the fourteen most valuable unmentioned assets, which is the right end.
- Incoming variety held at 12 of 12 in every league, so the side that already
  worked was not traded away for the side that did not.
- Cost: 34ms to 101ms per league on a 12 to 32 team league, against a 3-league
  window on the cross-league walk. Roughly double the old engine and still far
  inside a server action.
- npx tsc --noEmit: clean
- npm test: 1279 tests across 94 files, all pass (14 new)
- npm run build: compiles clean in 14.0s, no warnings
- No browser testing this pass; no dev server left running.

---

T490 | completed | FAAB league mode: price a bid against a real roster
     | files: lib/power-pulse/project.ts, lib/power-pulse/engine.ts,
     |   lib/faab/types.ts, lib/faab/default-settings.ts, lib/faab/settings.ts,
     |   lib/faab/marginal.ts, lib/faab/signals.ts, lib/faab/market.ts,
     |   lib/faab/ladder.ts, lib/faab/league-load.ts, lib/faab/league-faab.ts,
     |   lib/faab/multi-league.ts, lib/faab/backtest.ts,
     |   lib/faab/{marginal,signals,market,ladder}.test.ts,
     |   app/tools/faab/{page,faab-form,league-panel,league-result,actions}.tsx,
     |   app/admin/faab/faab-settings-manager.tsx,
     |   scripts/backtest-faab.ts, package.json
     | depends on: T489
     | verified: yes (no schema change so no RLS work; a11y + security reviewed below)

The old calculator answered "how good is this player" (overall rank divided by
teams times starters, read off a curve). A FAAB bid asks something else: how
many points does he add to YOUR lineup over the weeks YOU have left. League
mode answers that question instead, and the manual calculator is untouched and
still the default view.

WHAT IT DOES
- Projects every roster in the league with the Power Pulse model, adds the free
  agent, and rebuilds every remaining week's optimal lineup. The difference IS
  the answer. A player who never cracks the lineup is reported as adding zero
  rather than as a percentage.
- Simulates the season twice, before and after, for wins and playoff odds.
- Names the cheapest drop by what the LINEUP loses, not by raw projection. A
  backup QB projected for 16 is a cheaper cut than a WR3 projected for 9 in a
  one-QB league, and sorting by points gets that backwards.
- Reads six player signals (snap-share role change, beat rate, availability,
  volatility, remaining matchups, past positional finishes) and three market
  ones (rival budgets, how many rivals would start him, time of season).
- Prices against what the league has actually paid, from winning bids already
  preserved in league_transactions.metadata.settings.waiver_bid. No new sync.
- Answers the same question across every league at once, capped at 10.

THE ONE STRUCTURAL DECISION
Value and price are separated and never collapsed. Walk-away is derived from
value (upgrade x need x player quality) and cannot be raised by market pressure;
the recommended bid is value seen through rival wallets and league history and
can only sit at or under it. A rich opponent makes a player cost more, it does
not make him worth more, and conflating the two is how managers overpay. There
is a test for exactly this (ladder.test.ts, "market pressure changes the price
but never the walk-away ceiling").

DUMP MODE, KEPT AND EARNED
Still present, now triggered by measured impact (playoff-odds swing or points a
week) instead of by ranking, and explicitly refused for a team already under the
playoff-odds floor. Telling a 3% team to empty its budget was the worst advice
the tool could give.

READ ONLY
Never writes, never syncs matchups, never touches league_power_pulse_cache.
It is a question about a roster that does not exist, so it must not be able to
overwrite the real one's cached answer. No cron added.

SHARED MODEL, ONE COPY
lib/power-pulse/project.ts is new and holds the per-player-week projection that
was inline in engine.ts. Both the engine and FAAB import it, so a FAAB answer
and the Power Pulse page next to it cannot disagree about a projection. Power
Pulse behavior is unchanged (47 existing tests pass untouched).

SECURITY
Public server actions, no sign-in required (a Sleeper username is enough, same
as League Pulse). Service role is used because faab_calculator_settings is
service-role-only; everything else read is public under RLS and already visible
on /leagues/<id>, so a league id you are not in leaks nothing new. Rate limited
per actor and fails closed: connect 10/min, single bid 12/min, all-leagues
4/min. Ids regex-validated; the username check also rejects ".." before it
reaches a Sleeper URL. Simulation runs capped at 20000 in the schema so an admin
cannot make a page view run an unbounded loop twice.

ACCESSIBILITY
Panel is a real disclosure (aria-expanded + aria-controls, content hidden when
closed) under an h3, so the manual calculator keeps the page's reading order.
Every input labelled; errors are role="alert"; results announce through one
short polite live region rather than re-reading the card. The week strip is a
wrapping list where each entry carries its own sr-only sentence, because
"Wk 7 +4.2" is not a sentence. Nothing is hidden at any breakpoint: the
all-leagues view is a stacked list rather than a table with dropped columns, and
the impact figures go 2-up on mobile and 4-up on desktop. Tap targets 44px.

HONESTY
Every answer carries a confidence grade from how much data is actually behind
it, and low confidence says so in the copy. Missing pieces degrade rather than
guess: no stored schedule means points-only with a notice, no published FAAB
budget falls back to the reader's typed budget with a notice, and a league we
hold no rosters for is reported as unchecked instead of as "he is available".

BACKTEST
npm run backtest:faab grades the price curve against real winning bids per
league season. It measures calibration, not a replay, and says so in its own
header: historical rosters are not stored, so a true replay is impossible and
approximating it would reintroduce the exact assumption this work removed.

- npx tsc --noEmit: clean
- npm test: 1322 tests across 98 files, all pass (43 new)
- npm run build: compiles clean, /tools/faab 16.3 kB
- No browser testing this pass; no dev server left running.

---

T491 | completed | FAAB: lead with the league offer, and give the manual path real math
     | files: lib/faab/manual.ts, lib/faab/manual.test.ts, lib/faab/outlook.ts,
     |   lib/faab/types.ts, lib/faab/default-settings.ts, lib/faab/settings.ts,
     |   lib/faab/{ladder,signals,market}.ts, lib/faab/ladder.test.ts,
     |   app/tools/faab/{page,faab-form,league-panel,actions}.tsx,
     |   app/tools/faab/{bid-result,manual-result,player-combobox}.tsx,
     |   app/admin/faab/faab-settings-manager.tsx
     |   (deleted: app/tools/faab/league-result.tsx)
     | depends on: T490
     | verified: yes (no schema change; a11y + copy reviewed below)

THE LAYOUT WAS BURYING THE BETTER ANSWER
League mode shipped as a collapsed disclosure under the manual form, which is
where nobody found it. It now leads: a bordered, glowing block at the top of the
page asking the question outright, then an "or" separator with generous margin,
then the manual calculator. Both paths are complete on their own, which is what
makes the "or" mean something. Each has its own player search (extracted to
player-combobox.tsx so there is still one implementation).

THE MANUAL PATH IS NO LONGER JUST RANK MATH
It could not ask "what does he add to YOUR lineup" without a roster, so it asks
the nearest answerable question: what does he add over the last player you could
already start at his position? Rank every player at that position by projected
points a week, walk to where a league this size runs out of starters, and the
gap is what you are buying. That is measurable from projections alone.

This subsumes the old depth multipliers rather than sitting beside them:
replacement rank scales with teams AND starter count by construction, so a
14-team league with 11 starters gets a deeper line without a hand-tuned nudge.

Manual mode now gets: rest-of-season projections, beat rate, availability,
volatility (widens rather than moves), snap-share role change, remaining
matchups from our own defense table, past positional finishes, time-of-season
urgency, and the same walk-away / bid / aggressive ladder. What it cannot have
is anything requiring a league: rival budgets, who else wants him, league bid
history, and playoff odds. Those are simply absent rather than faked.

The original rank-and-value calculator survives as the documented fallback for
the offseason and for players nobody publishes weekly numbers for. Showing the
older, simpler number beats showing none.

ONE FETCH, INSTANT CONTROLS
The server returns the whole position projection curve rather than a single
replacement number, so league size, starters, budget, and need all recompute in
the browser. Dragging a control does not fire a request.

COPY
Rewritten throughout for density. The result explanation went from a five-clause
paragraph to short declarative sentences; every signal detail lost its trailing
justification clause; the economy notice, dump note, and both help strings were
cut roughly in half; the hero and meta description now lead with what the tool
answers ("what to bid, and when to walk away") rather than describing its
inputs. No information was dropped, only the words around it.

SHARED RESULT SURFACE
league-result.tsx became bid-result.tsx and renders both modes off one view
model, so they cannot drift into looking like different products. The figures
change meaning between modes and the card says which mode produced them: league
mode shows weeks-he-starts and playoff odds, manual mode shows replacement level
and where the startable line falls. The week strip shows points added in league
mode and matchup difficulty in manual mode.

ACCESSIBILITY
The league block is a labelled section with a real h2 rather than a disclosure
button, so it sits in the page outline where its prominence suggests. The "or"
is role="separator" with an accessible name. Both paths announce through their
own short polite live region. Every figure keeps its sr-only sentence. Nothing
hidden at any breakpoint; 44px targets throughout.

- npx tsc --noEmit: clean
- npm test: 1334 tests across 99 files, all pass (12 new in manual.test.ts)
- npm run build: compiles clean, /tools/faab 20 kB
- No browser testing this pass; no dev server left running.

---

## Beacon Brief: stop the duplicate articles (migrations 0177, 0178)

THE DEFECT
Migration 0169 set bb_merge_block_relevance_tier to 3. The classifier assigns
tier 3 to every post about a current player's football situation, which is every
post that can become an article, so the floor did not limit merging, it ended it.
Between 2026-08-04 and 2026-08-07 the floor fired 129 times and the follow-up
matcher ran twice. Twenty-three of forty-nine published articles covered an event
another article already covered: 6 for one Jonathan Taylor contract, 5 for one
Gibbs contract, 5 for one Jalon Walker ACL, 4 for one Diggs signing.

THE FIX (migration 0177 + code)
lib/beacon-brief/event-key.ts computes <kind>:<sorted player ids> from work the
pipeline has already done. An exact match against a live article inside 72 hours
is the same event by construction, settled in code with no model call, and it
outranks the tier floor. Overlapping keys still go to the model, now with a short
plausible candidate list. Also: the tier floor drops to 0, slug collisions with a
live same-subject article merge instead of publishing behind a random suffix,
candidates compare across sources rather than within one account, a merged post
keeps its Discord card (Discord and the website decide separately now), a merge
gate asks whether the post changes anything before paying for a rewrite, merge
rewrites run on the triage model, and a per-player daily article cap (3) backstops
all of it with a throttled email.

bb_revision_triage_prompt removed; the merge gate replaced it.

THE CLEANUP (migration 0178)
36 URLs merged into 11 articles across 10 clusters plus one genuine roundup.
25 slugs 308-redirected in next.config.ts. All replacement prose written by hand
for the migration; no Anthropic API call produced any of it. The duplicates
contradicted each other on matters of fact (Montgomery in Detroit vs traded to
Houston; a fabricated August 13 groin injury for Walker; three different rankings
for Taylor's contract), so every merged article is written from the source posts
plus only cross-corroborated detail, and unresolvable conflicts are omitted.

- npx tsc --noEmit: clean
- npx vitest run: 1392 tests across 102 files, all pass (23 new in event-key.test.ts)
- npx next build: compiles clean
- Migrations applied to prod and verified: 25 archived, 0 duplicate event keys
  among published, 0 posts pointing at archived rows, 0 stale entity links,
  every redirect source archived and every destination published
- lib/database.types.ts regenerated (articles.event_key, news_ingestions.event_key)
- RLS unchanged; new columns inherit existing table policies (verified in pg_policies)
- Not committed. Discord untouched.

---

## Beacon Brief: stop the fabrication (migration 0179)

THE DEFECT
Auditing the duplicates for the 0178 merge surfaced a second defect the duplication
had been hiding: the articles contradicted each other because several contained
facts that came from nowhere. A post whose entire text was "Worst part of training
camp:" plus a link produced a 700-word published article naming a groin injury, a
date, a joint-practice opponent, a 23-20 score, and a quote from a head coach who
does not coach the team. The real event was a torn ACL on a different date.
Also found: Montgomery in Detroit vs traded to Houston, Diggs' ACL with New England
vs Houston, three different rankings for Taylor's contract, 5 vs 6 Flowers
touchdowns, a July 10 date on a workout reported "today" on August 5.

WHY THE EXISTING RULE FAILED
bb_article_prompt already said do not invent facts. Everything else in the same
prompt demanded a full article: ## subheadings, full name plus position plus team
on first mention, the search phrase in four places, a roster-impact close. Handed a
fragment, a model cannot satisfy both, and the prompt never said which wins.
bb_article_research_prompt made it worse by never defining a not-found answer, so
empty research came back looking like research.

THE FIX
- bb_article_research_prompt REPLACED: attribution required per line, CONFIRMED vs
  UNCONFIRMED sections, literal NO RESULTS when nothing is found, never date what
  was not seen dated.
- bb_article_prompt + bb_revision_rewrite_prompt: a fabrication section naming the
  eight categories that were actually invented, stating accuracy outranks structure,
  and that there is no minimum length. The rewrite version also forbids correcting
  the existing article from memory.
- bb_categorize_prompt: context_score rewritten to prefer 0 when torn and to name
  the quote-tweet-stub shape that got through.
- worker.ts: refuses to call the writer when the post carries under 60 characters
  of usable text AND research returned nothing. Both halves must be empty. The
  Discord card still posts. A prompt is an instruction; this is arithmetic.

- npx tsc --noEmit: clean
- npx vitest run: 1398 tests across 103 files, all pass (6 new in thin-post.test.ts)
- npx next build: compiles clean
- Migration applied to prod and verified: all four prompts carry the new text
- No schema change, no RLS change, no type regeneration

---

## On The Clock: the premium pass (2026-08-08)

Twelve phases in one session. Nothing committed or pushed. Four migrations applied
to prod (0180 to 0183) and verified; `lib/database.types.ts` regenerated.

### The defect that started it

Team Need recommended a tight end almost every time. Not a bug: the engine was
answering the wrong question. `needRaw = fit.factor * formatMult * (50 + 0.25 *
valueScore + 0.25 * vorScore)` where `fit.factor` is 1.0 for a position with an
open dedicated slot and 0.7 for a flex. Most leagues start exactly one tight end
and it is the slot people fill last, so tight end held the 1.0 long after running
back and receiver had spilled to 0.7, the TE-premium multiplier stacked another
1.15 on top, and value could only move the result across a 50-point band.
`replacementByPosition` compounded it by looking for the 48th-best available
tight end in a 12-team league and clamping to the end of a shallow pool, which
made every remaining tight end look scarce.

`lib/on-the-clock/recommend-points.test.ts` pins both behaviours: the heuristic
takes the tight end, the points engine takes the receiver.

### Tasks

T488 | completed | migration 0180: league_metadata jsonb on on_the_clock_draft_cache
     | files: supabase/migrations/0180_otc_league_metadata.sql
     | verified: yes (pg_policies checked, column inherits table policies)
T489 | completed | sync captures the Sleeper league object; cache shapes scoring + slots
     | files: lib/on-the-clock/sleeper-sync.ts, lib/on-the-clock/cache.ts, lib/on-the-clock/types.ts
     | depends on: T488
T490 | completed | buildSlotModel prefers roster_positions over draft.settings.slots_*
     | files: lib/on-the-clock/recommend.ts
T491 | completed | migration 0181 + projection board (shared per scoring signature)
     | files: supabase/migrations/0181_otc_projection_cache.sql, lib/on-the-clock/projection-board.ts
T492 | completed | migration 0182 + Draft Pulse engine
     | files: supabase/migrations/0182_otc_pulse_cache.sql, lib/on-the-clock/draft-pulse.ts
T493 | completed | pulse orchestrator + POST /api/on-the-clock/pulse
     | files: lib/on-the-clock/pulse-service.ts, lib/on-the-clock/pulse-types.ts, app/api/on-the-clock/pulse/route.ts
T494 | completed | ADP draft simulation
     | files: lib/on-the-clock/adp-sim.ts
T495 | completed | marginal starting-lineup engine with the depth handover
     | files: lib/on-the-clock/marginal.ts
T496 | completed | Team Need + Best Value rewrite, mode-aware
     | files: lib/on-the-clock/recommend.ts, lib/on-the-clock/board-types.ts
T497 | completed | build mode: types, defaults, zod, clamps, selector, per-draft storage
     | files: lib/on-the-clock/types.ts, default-settings.ts, settings.ts, app/tools/on-the-clock/build-mode-selector.tsx, draft-prefs.tsx
T498 | completed | surplus value replaces the pick_no minus ADP metric
     | files: lib/on-the-clock/surplus.ts, lib/on-the-clock/awards.ts
T499 | completed | seven new awards + per-award admin toggles + AWARDS_VERSION
     | files: lib/on-the-clock/awards.ts, app/tools/on-the-clock/rankings-awards.tsx
T500 | completed | migration 0183 + draft grades, frozen into snapshots
     | files: supabase/migrations/0183_otc_snapshot_grades.sql, lib/on-the-clock/draft-grade.ts, lib/on-the-clock/draft-snapshot.ts, lib/on-the-clock/snapshot-types.ts, app/tools/on-the-clock/draft-grades.tsx
T501 | completed | shared trade margins (award and grade can no longer disagree)
     | files: lib/on-the-clock/trade-margins.ts
T502 | completed | clickable draft board + side-picker dialog + asset resolver
     | files: lib/on-the-clock/trade-assets.ts, app/tools/on-the-clock/draft-board.tsx, add-asset-dialog.tsx
T503 | completed | Signal Check server action + report for draft-room trades
     | files: app/tools/on-the-clock/actions.ts, signal-check-report.tsx, trade-analyzer.tsx
T504 | completed | rosters tab: Draft Pulse, archetype chip, sort toggle
     | files: app/tools/on-the-clock/rosters-rankings.tsx
T505 | completed | draft radar: runs, tier cliffs, picks until your turn, gone-before
     | files: lib/on-the-clock/draft-alerts.ts, app/tools/on-the-clock/draft-radar.tsx
T506 | completed | available list: engine ordering, projections, watchlist
     | files: app/tools/on-the-clock/available-list.tsx
T507 | completed | what your picks cost you, recap text, read-the-room shortcut
     | files: lib/on-the-clock/draft-recap.ts, app/tools/on-the-clock/draft-extras.tsx
T508 | completed | admin: build mode, marginal, awards, grades, alerts
     | files: app/admin/on-the-clock/on-the-clock-settings-manager.tsx
T509 | completed | tests for every new engine
     | files: lib/on-the-clock/marginal.test.ts, recommend-points.test.ts, draft-intel.test.ts, awards.test.ts

### Verification

- npx tsc --noEmit: clean
- npx vitest run: 1442 tests across 106 files, all pass (41 new)
- npx next build: compiles clean, /tools/on-the-clock 63.4 kB
- Migrations 0180-0183 applied to prod; pg_policies verified on all four tables
- lib/database.types.ts regenerated and prettier-formatted
- Not committed, not pushed. No dev server left running.

### Decisions worth re-reading

- **Draft Pulse is not Power Pulse.** A startup draft has no schedule, and
  CLAUDE.md forbids caching a Power Pulse without one. Draft Pulse publishes
  projected starting-lineup points and a within-league rank. No expected wins, no
  playoff odds, no projected finish, and nothing is written to
  `league_power_pulse_cache`.
- **Future picks go to Signal Check as picks, not as simulated players.** A pick
  in THIS draft resolves to the player ADP says goes there. A 2028 first has no
  ADP to simulate against, so it is priced from FF Beacon's published pick values.
- **Best Value keeps FF Beacon value as its spine** and adds a bounded
  multiplicative tilt per mode, so the card is still an FF Beacon Values card.
- **The points weight decays as the starting lineup fills** (quadratic, so the
  handover is late). Without it, a start-eleven league would tell everyone from
  the twelfth pick onward that nobody adds anything.
- **Absent is never zero.** A player with no projection is judged on value alone,
  not scored at zero points.

### Review pass (same session)

Four sub-agent reviews ran against the finished work: implementation, security,
accessibility, and performance. Findings fixed:

T510 | completed | RoomSummary was mounted only in the loading branch and threw a TDZ error
     | files: app/tools/on-the-clock/on-the-clock-client.tsx
     | Two agents found this independently. The Shift-R summary read consts declared
     | below the early return, so it threw when used and vanished once the room loaded.
T511 | completed | probe-based marginal engine: 5,239 lineup solves per request down to ~320
     | files: lib/on-the-clock/marginal.ts, lib/on-the-clock/marginal.test.ts
     | Adding one player to a transversal-matroid lineup gives max(0, points - d) for a
     | threshold d that depends only on (position, week). One probe per pair replaces one
     | build per candidate per week. Locked in by a 720-case brute-force property test.
T512 | completed | dialog focus fallback when an asset cannot be priced
     | files: app/tools/on-the-clock/add-asset-dialog.tsx
T513 | completed | turn and tier-cliff alerts re-announce on the next turn
     | files: lib/on-the-clock/draft-alerts.ts, on-the-clock-client.tsx, draft-intel.test.ts
T514 | completed | admin marginal weights, candidate cap, and trade minimum reach the engines
     | files: app/api/on-the-clock/pulse/route.ts, lib/on-the-clock/pulse-service.ts, awards.ts
T515 | completed | reliability award gates on the sample size its copy promises
     | files: lib/on-the-clock/draft-pulse.ts (starterWeeksPlayed), awards.ts
T516 | completed | awards and grades share one trade-margin computation
     | files: lib/on-the-clock/awards.ts, trade-margins.ts
T517 | completed | dedicated CPU rate limit on the pulse route, failing closed
     | files: app/api/on-the-clock/pulse/route.ts, lib/on-the-clock/cache.ts
T518 | completed | migration 0184: league_metadata withheld from anon and authenticated
     | files: supabase/migrations/0184_otc_league_metadata_private.sql
     | verified: yes (column_privileges checked on prod: service_role only)
T519 | completed | pick cache read paged; oversized request arrays rejected not iterated
     | files: lib/on-the-clock/cache.ts, app/api/on-the-clock/pulse/route.ts, actions.ts
T520 | completed | accessibility: sort target size, landmark flood, admin hints, grades layout
     | files: available-list.tsx, rosters-rankings.tsx, on-the-clock-settings-manager.tsx, on-the-clock-client.tsx
T521 | completed | copy and dead-code corrections from the implementation review
     | files: awards.ts, draft-grade.ts, draft-grades.tsx, available-list.tsx

- npx tsc --noEmit: clean
- npx vitest run: 1444 tests across 106 files, all pass
- npx next build: compiles clean
- Migration 0184 applied to prod and verified

### Cleanup pass (2026-08-08, second session)

Every deferred item below is now done, plus three things the owner reported from
a first look at the room. tsc clean, 1449 tests across 107 files pass, next build
compiles, migration 0185 applied to prod and verified.

T542 | completed | a continued redraft league was priced off the dynasty board
     | files: lib/sleeper-to-format.ts, lib/league-category.ts, lib/sleeper-to-format.test.ts
     | The owner reported the draft-room pool notice saying "dynasty startup draft"
     | in a redraft league. The copy was already right; the DETECTION was not.
     | deriveLeagueFormat read a non-empty previous_league_id as a dynasty signal,
     | and Sleeper sets that on ANY league carried season to season. Confirmed on
     | prod: "Brooklyn 99 Redraft" and "Sunday Funday" both carry settings.type = 0
     | with a prior season, so both derived as dynasty. Now type 2 alone is dynasty,
     | matching lib/league-category.ts, which already classified this way.
     | BLAST RADIUS: this is the shared resolver, so League Pulse, Signal Check
     | imports, and the trade finder all now price a continued redraft league off
     | the redraft board too. That is the fix, not a side effect, but it changes
     | stored leagues.format_config_id on their next pulse.
     | verified: yes (unit tests pin type 0 + prior season, type 1, and type 2)
T543 | completed | the Trade Analyzer tab is now the Trade Builder
     | files: on-the-clock-client.tsx, trade-analyzer.tsx, page.tsx,
     |        app/admin/on-the-clock/on-the-clock-settings-manager.tsx
     | Tab label, panel heading, empty state, the marketing feature card, and the
     | admin section. The mode chips lost their old names too ("Startup Trade
     | Builder" beside a heading reading Trade Builder said the same thing twice);
     | they now name the pool: "Startup draft" / "Rookie draft".
     | NOT renamed: the component and module file names, the Signal Check trade
     | analyzer at /tools/signal-check, and lib/trade-analyzer.ts.
     | verified: yes
T544 | completed | wiring audit of the previous session's work
     | Everything reported missing is wired; two are explained rather than fixed.
     | - Trade Builder: clickable board, side-picker dialog, both build modes, the
     |   Signal Check round trip and its report all reachable from the tab.
     | - Draft Pulse on the Rosters tab renders whenever pulseTeams is non-empty.
     |   On a COMPLETED draft it reads snapshot.pulse, and every one of the 17
     |   snapshot rows on prod is still snapshot_version 1, which predates Draft
     |   Pulse and grades. getOrCreateDraftSnapshot serves an existing row as-is
     |   and never upgrades it, so an already-locked draft will never show either.
     |   That freeze is deliberate (see handoff.md); the owner's call whether to
     |   re-finalize. A LIVE draft is unaffected.
     | verified: yes

T522 | completed | A1: hoist the draft radar's live region into the room shell
     | files: app/tools/on-the-clock/on-the-clock-client.tsx, app/tools/on-the-clock/draft-radar.tsx
     | why: the announcer unmounts on the Rosters tab and the full-width board
     |      view, so runs and tier cliffs that fire while a user is parked there
     |      are never spoken. The only deferred item that is a gap rather than
     |      polish. Do this one first.
     | verified: yes

T523 | completed | P1: memoize the parsed projection board in process
     | files: lib/on-the-clock/projection-board.ts
     | why: 681 KB read and parsed from Supabase on every pulse request, for a
     |      payload that cannot change during a draft. ~1.6 GB per draft with 12
     |      viewers.
     | verified: yes

T524 | completed | P3: memoize boardPlayers, available, and the recommendation
     | files: app/tools/on-the-clock/on-the-clock-client.tsx
     | why: the render body has one useMemo. Everything below it recomputes on
     |      every realtime pick, and the fresh arrays also kill the useMemo inside
     |      available-list.tsx. Fixing this repairs that one for free.
     | depends on: none (but do before T531)
     | verified: yes

T525 | completed | P2: stop re-sending the 43 KB players map on every pick
     | files: lib/on-the-clock/pulse-service.ts, app/api/on-the-clock/pulse/route.ts,
     |        lib/on-the-clock/client.ts, app/tools/on-the-clock/on-the-clock-client.tsx
     | why: ~103 MB of egress per draft carrying identical data. Add a boardEtag
     |      from (scoringSignature, season, fromWeek) and omit players on a match.
     |      Same change can drop the ~23 KB survivorIds upload by running the ADP
     |      simulation server-side, which also closes T534.
     | verified: yes

T526 | completed | P4: render tab panel BODIES conditionally, keep the panels mounted
     | files: app/tools/on-the-clock/on-the-clock-client.tsx
     | why: DraftBoard reconciles 408 cells on every pick even when the user is on
     |      another tab. Keep the div[role=tabpanel] for ARIA; gate its children.
     | verified: yes

T527 | completed | A2: debounce the available-list status announcement
     | files: app/tools/on-the-clock/available-list.tsx
     | why: typing a player name queues one announcement per keystroke and
     |      interrupts the character echo.
     | verified: yes

T528 | completed | A3: board cells must not fail silently in the trade builder
     | files: app/tools/on-the-clock/trade-analyzer.tsx, app/tools/on-the-clock/draft-board.tsx
     | why: pressing Enter on an unpriceable or already-used cell does nothing and
     |      says nothing, while the cell label always reads "Add to trade".
     | verified: yes

T529 | completed | C1: one projection for an unmade pick, not two
     | files: lib/on-the-clock/trade-analyzer.ts, lib/on-the-clock/trade-assets.ts
     | why: the catalog projects by board VALUE order and floors at 50; the
     |      resolver uses the ADP simulation and returns 0. The dropdown can name
     |      one player and add another.
     | verified: yes

T530 | completed | C2: traded-future-pick options keep their owner
     | files: lib/on-the-clock/trade-analyzer.ts, lib/on-the-clock/trade-assets.ts
     | why: catalog id and resolver id disagree, so usedIds never suppresses the
     |      option and the placed asset drops which team's pick it was.
     | verified: yes

T531 | completed | P8: React.memo, stable prop objects, and Map week lookups
     | files: app/tools/on-the-clock/*.tsx, lib/on-the-clock/marginal.ts, draft-pulse.ts
     | why: no React.memo anywhere in the tool; several objects rebuilt every
     |      render and passed to children; weeks.find() linear scans where a Map
     |      would do (~490k redundant comparisons per request).
     | depends on: T524
     | verified: yes

T532 | completed | P5: name the columns in readDraftCache
     | files: lib/on-the-clock/cache.ts
     | why: select("*") pulls 105 KB of pick metadata to read four fields.
     |      CAREFUL: shapePickRow is shared with the client Realtime handler,
     |      which receives the full row, so this needs tolerant field access or a
     |      second shaper.
     | verified: yes

T533 | completed | P6 and P7: one settings load per request, and a narrower player select
     | files: lib/on-the-clock/pulse-service.ts, lib/on-the-clock/projection-board.ts
     | why: loadPowerPulseSettings runs twice; loadPlayerFacts selects a 2.4 MB
     |      jsonb to read one string on cold builds.
     | verified: yes

T534 | completed | C3: stop truncating survivorIds in board order
     | files: app/api/on-the-clock/pulse/route.ts, app/tools/on-the-clock/on-the-clock-client.tsx
     | why: the 800 cap takes the first 800 by board order, so K/DEF can be cut
     |      and then read as maximal scarcity. Closed for free by T525.
     | depends on: T525
     | verified: yes

T535 | completed | A4: normalize heading levels across the new tab panels
     | files: app/tools/on-the-clock/panel.tsx, draft-radar.tsx, rosters-rankings.tsx,
     |        draft-grades.tsx, on-the-clock-client.tsx
     | why: Rosters and Grades open at h3 with no h2 above them; the radar jumps
     |      h2 to h4. Mechanical, spread across six files.
     | verified: yes

T536 | completed | A5 and A6: keyboard-reachable scroll regions, 44px tabs at every width
     | files: app/tools/on-the-clock/draft-board.tsx, available-list.tsx, draft-extras.tsx,
     |        on-the-clock-client.tsx
     | why: three overflow-x-auto containers have no tabIndex, role, or name
     |      (WCAG 2.1.1); the view tabs carry sm:min-h-0 and drop to ~32px above
     |      the sm breakpoint, which the project's rule does not permit.
     | verified: yes

T537 | completed | A7: admin section headings and checkbox target size
     | files: app/admin/on-the-clock/on-the-clock-settings-manager.tsx
     | why: five CollapsibleSection titles are spans, invisible to heading
     |      navigation; the toggle checkboxes are ~20px.
     | verified: yes

T538 | completed | A8: the remaining small accessibility items
     | files: signal-check-report.tsx, draft-board.tsx, rosters-rankings.tsx,
     |        available-list.tsx, trade-analyzer.tsx, draft-extras.tsx
     | why: eight items, each one or two lines. Live regions inserted with their
     |      content, "Open slot" missing from empty cell labels, a wrong
     |      aria-expanded, an unannounced roster re-sort, a doubly announced
     |      article label, a redundant sr-only label, a disabled button with no
     |      associated reason, and the Shift+R collision with NVDA quick nav.
     | verified: yes

T539 | completed | C4: drop reverted picks from the cache on resync
     | files: lib/on-the-clock/sleeper-sync.ts
     | why: picks absent from a fresh Sleeper payload are never deleted, so a
     |      commissioner-reverted pick lingers forever.
     | verified: yes

T540 | completed | S1: evict old projection and pulse cache rows
     | files: supabase/migrations/ (extend 0113 or add a sibling)
     | why: on_the_clock_projection_cache has no eviction. Each distinct league
     |      scoring shape writes a ~1 MB row that is never deleted. Slow to
     |      exploit behind the two IP budgets, but unbounded.
     | verified: yes

T541 | completed | C5: dead code and one wrong comment
     | files: awards.ts, draft-alerts.ts, recommend.ts, draft-grade.ts,
     |        app/tools/on-the-clock/trade-analyzer.tsx, types.ts
     | why: seven small items, listed individually in handoff.md. Includes
     |      recommend.ts replacementByPosition, where the CODE is right and the
     |      comment describes something else.
     | verified: yes

### Where the deferred fixes landed differently from the plan

Two items were solved another way than handoff.md proposed, on purpose.

- **T534 (survivorIds).** The plan was to run the ADP simulation server-side so
  the list is never uploaded. That would mean loading the ranked board and its
  ADP on the server on every pulse request, which costs more than the 23 KB it
  saves. Instead the CLIENT now caps survivors at 25 per POSITION rather than
  the route capping the first 800 in board order. The defect the finding
  described (a whole position truncated away, then read as maximal scarcity) is
  closed, because every position is always represented, and the upload drops to
  roughly a quarter of its size.
- **T532 (readDraftCache columns).** The plan warned that shapePickRow is shared
  with the Realtime handler. Rather than making one shaper tolerant, there are
  now two: shapeProjectedPickRow for the projected read and shapePickRow for the
  full Realtime row, with lib/on-the-clock/cache-shape.test.ts pinning them to
  the same output for both an empty string and an absent field.

### Review pass (same session)

Four sub-agent reviews ran against the finished work: implementation, security,
accessibility, and performance. They found two things that would have shipped
broken, one of them written this session. Findings fixed:

T545 | completed | the reverted-pick delete wiped a live board on any Sleeper hiccup
     | files: lib/sleeper.ts, lib/on-the-clock/sleeper-sync.ts
     | Found independently by the implementation and the security reviews.
     | getSleeperDraftPicks flattened a failure to [], so a 429, a timeout, or a
     | 5xx made highestPickNo 0 and T539's new delete removed every cached pick
     | for the draft: drafted players back on the available board, rosters empty,
     | pinned for the whole cooldown. This is the failure CLAUDE.md already calls
     | out for Power Pulse. getSleeperDraftPicksOrNull keeps the null, and the
     | sync now fails outright rather than writing anything on a picks outage.
     | verified: yes
T546 | completed | the Grades tab was dead in every live draft
     | files: app/tools/on-the-clock/on-the-clock-client.tsx
     | Pre-existing, from the previous session. teamRollups was gated on rosters,
     | rankings, and the board view but not grades, and computeDraftGrades returns
     | an empty array for empty rollups, so an in-progress draft rendered the
     | "nothing to grade yet" state forever. Snapshot mode hid it.
     | verified: yes
T547 | completed | the pulse effect could drop its response and pin "Loading projections"
     | files: app/tools/on-the-clock/on-the-clock-client.tsx
     | The effect stamped its signature before firing and cancelled through a
     | cleanup flag. A re-run with an UNCHANGED signature (the sync upserts every
     | pick row, so Postgres emits updates carrying no new pick) cancelled the
     | in-flight request and then returned at the guard without firing a
     | replacement. On a first load that meant no projections for the session.
     | Supersession is tracked by the signature now, not by a per-effect boolean.
     | verified: yes
T548 | completed | T526 reverted for six of the seven tab panels
     | files: app/tools/on-the-clock/on-the-clock-client.tsx
     | Gating a panel's body on its tab unmounts it, and with it the search box,
     | the sort, a half-built trade, and every open grade card. The accessibility
     | review is right that this costs a screen-reader user more than a sighted
     | one: re-finding a row in a 600-player table by ear is expensive. Only the
     | Board panel stays gated; it holds no state and is 400-odd cells.
     | verified: yes
T549 | completed | Trade History priced unmade picks by the method T529 replaced
     | files: lib/on-the-clock/trade-history.ts, on-the-clock-client.tsx,
     |        draft-snapshot.ts, awards.test.ts
     | T529 was half applied. The same draft slot named one player at one price
     | in the Trade Builder and a different player at a different price on a
     | trade card, and the awards and the trades component of the grades read the
     | superseded one. Both read the shared simulation now.
     | verified: yes
T550 | completed | includePreDraftRoster was trusted, uncached, and freezable
     | files: lib/on-the-clock/pulse-service.ts
     | The flag comes off the request body and changes every team's projected
     | lineup, but it was absent from the pulse cache's model_version, and the
     | durable row is one per draft. One request with it flipped poisoned every
     | other viewer, and after the last pick the snapshot finalizer would freeze
     | it permanently. It is part of the version now.
     | verified: yes
T551 | completed | the alert announcer swallowed the re-announcements it exists for
     | files: app/tools/on-the-clock/draft-radar.tsx
     | Alert ids fold in the pick number so a run that EXTENDS and a cliff that
     | gets CLOSER speak again, and both produce a new id carrying the same
     | sentence. Setting state to a string it already holds changes no text node,
     | so nothing was spoken. Clear-then-set, matching RoomSummary. Also stopped
     | speaking the turn alert, which the command bar already says assertively.
     | verified: yes
T552 | completed | the remaining review findings
     | files: available-list.tsx, rosters-rankings.tsx, draft-board.tsx,
     |        trade-analyzer.tsx, on-the-clock-client.tsx, cache.ts,
     |        cache-shape.test.ts, projection-board.ts, pulse-service.ts,
     |        app/api/on-the-clock/pulse/route.ts, week-index.ts,
     |        app/admin/on-the-clock/on-the-clock-settings-manager.tsx
     | Grades tab heading nesting; a dozen "Future picks" landmarks; the
     | available list re-announcing on every incoming pick; the admin h2 as the
     | summary's direct child with the blurb moved into the body; the dead
     | React.memo behind an inline onSelectPick; adpBySleeperId keyed on the raw
     | board so it stops defeating that memo; the projections map hoisted out of
     | the rec memo; goneList's O(n*m) scan; the realtime handler allocating a
     | fresh draft object for an unchanged pick count; a fourth and inconsistent
     | isDynasty; the projection memo serving at twice its TTL and evicting by
     | write order; readDraftCache swallowing its query error; maxCandidates
     | clamped on the read path; repeat announcements in two more regions;
     | weekFor's duplicate-week ordering; a stale docstring; and a shaper test
     | that now derives its fixture from PICK_COLUMNS instead of hand-writing it.
     | verified: yes

### Verification

- npx tsc --noEmit: clean
- npx vitest run: 1452 tests across 107 files, all pass
- npx next build: compiles clean
- Migration 0185 applied to prod. Verified: one function, jsonb return, EXECUTE
  for service_role only (checked in pg_proc.proacl on prod), and a
  begin/rollback run of the full sweep.
- lib/database.types.ts regenerated and prettier-formatted.
- No browser testing (unchanged from the previous session).

### Owner follow-ups (same session)

T553 | completed | who is on the clock leads the sidebar on every tab
     | files: app/tools/on-the-clock/on-the-clock-client.tsx
     | DraftRoomStatus now renders above DraftRadar in sidebarPanels. It is the
     | panel a drafter checks constantly, so it goes first by eye and first by
     | tab order; the radar answers the follow-up question.
     | verified: yes
T554 | completed | Draft Pulse gets its own tab, out of Awards
     | files: app/tools/on-the-clock/draft-pulse-board.tsx (new),
     |        rankings-awards.tsx, on-the-clock-client.tsx
     | A ranking table was never an award. The new tab puts the POINTS ranking
     | and the VALUE ranking next to each other, which is the comparison that
     | matters during a draft: value counts future picks, and a lineup cannot
     | start a pick. Also on the tab: a "your team" summary (score, rank, points
     | behind the leader, thinnest starting slot, projection coverage), a
     | "where the two rankings disagree" section naming the teams that start
     | better or worse than they own, and a per-team positional points
     | breakdown on one shared scale. Reliability is shown only where there are
     | at least 8 weeks of history behind it. No expected wins and no playoff
     | odds anywhere, per the Draft Pulse rule.
     | Awards keeps only the trophy cards and lost its `teams` / `myRosterId`
     | props; PowerRankingsTable was deleted with them.
     | verified: yes
T555 | completed | Awards, Draft Pulse, and Grades have a real pre-draft state
     | files: app/tools/on-the-clock/states.tsx (NotStartedCard),
     |        rankings-awards.tsx, draft-grades.tsx, draft-pulse-board.tsx,
     |        on-the-clock-client.tsx
     | Before the first pick these three showed a full page of real-looking
     | placeholders: every award "up for grabs", a grade table of zeroes, and
     | every team tied on points. Those read as verdicts rather than as the
     | absence of one. Each now renders a branded card that says the draft has
     | not started and lists what will appear once it does.
     | The gate is draftCache.picks.length > 0, except Draft Pulse, which also
     | opens when any team already projects points: a dynasty ROOKIE draft sits
     | on rosters that exist, so those teams have a real score before a single
     | rookie is taken.
     | verified: yes

### Review pass on the owner follow-ups

The same four reviews ran again. Security found nothing. Performance found one
optional saving and confirmed the rest. Implementation and accessibility each
found one thing worth stopping for.

T556 | completed | an empty projection slate rendered a complete, fake ranking
     | files: app/tools/on-the-clock/draft-pulse-board.tsx, on-the-clock-client.tsx
     | The not-started gate was `draftStarted || anyPoints`, and the first term
     | short-circuited the only test that asks whether projections EXIST. A draft
     | with picks whose slate is empty (a past season, or a season with nothing
     | published yet) rendered a full table of 0.0 pts/wk with ranks 1..N, a
     | "disagreements" section built out of that noise, and a header reading
     | "averaged over the 0 remaining weeks". Exactly the degenerate-answer
     | failure CLAUDE.md forbids for Power Pulse. Three states now: no picks,
     | no projections, and the real board.
     | verified: yes
T557 | completed | the not-started and empty cards had no heading
     | files: app/tools/on-the-clock/states.tsx
     | These cards are frequently the ENTIRE contents of a tab panel, and their
     | title was a styled paragraph, so pressing H inside the panel found
     | nothing. That is the state a user sits in while waiting for a draft to
     | start, on three tabs at once. Both cards take a headingLevel now,
     | defaulting to h2.
     | verified: yes
T558 | completed | the rest of the round-two findings
     | files: draft-pulse-board.tsx, dashboard-panels.tsx, on-the-clock-client.tsx
     | - The archetype chip's screen-reader text came from League Pulse's
     |   classifier and said "by Power Pulse", naming a different model on the
     |   one tab that spends its header explaining it is not that model. It has
     |   its own sentence now, in this tab's vocabulary.
     | - DraftRoomStatus is mounted twice (rail and board view) and both copies
     |   hardcoded id="room-status", so the visible panel's aria-labelledby
     |   resolved to the HIDDEN copy's heading and could compute an empty name.
     |   It takes an instanceId. Pre-existing, surfaced by the reorder.
     | - The reliability column used a hardcoded 8-week gate while the awards
     |   use the admin's minAccuracyWeeks, so lowering the setting would crown
     |   an award for a team this table still showed as unjudgeable.
     | - Team name on the mover card was ink-subtle, about 3.7:1, under the AA
     |   floor. Now ink-muted, matching the same data in the tables.
     | - A polite region announces when the panel swaps between its three
     |   bodies; the positional numbers carry their unit for a screen reader;
     |   the loading copy no longer promises a table that is not rendered; the
     |   "your team" rank denominator is the league size, not the row count.
     | - The pre-draft grades tab no longer sorts the whole 800-player board to
     |   build a market curve it then throws away.
     | verified: yes
T559 | completed | league-feed trades hid the consolidation credit that decided them
     | files: components/signal-check-trade-card.tsx, components/value-adjustment-row.tsx,
     |        app/tools/signal-check/trade-result.tsx,
     |        app/tools/signal-check/v/[shareId]/page.tsx, docs/signal-check.md
     | Trades pulled from a Sleeper league are graded by the same pipeline as the
     | calculator, and the consolidation credit was computed and folded into the
     | verdict and the margin, but SignalCheckTradeCard never rendered the "Value
     | adjustment" row. On 19 of 51 real trades in one league the card showed a
     | side with fewer assets winning, or a 4-for-2 called "Fair Trade" off a
     | 16.8% credit, with nothing on screen naming the reason. Measured by
     | running analyzeLeagueTrades over that league, not by reading the code: the
     | four callers of runPipeline are byte-identical in how they pass settings
     | and poolMax, so the gap was only ever in the render.
     | The row moved from app/tools/signal-check/ to components/ because the card
     | is the third surface to need it and a shared component importing out of a
     | route folder inverts the dependency. docs/signal-check.md now lists all
     | four surfaces so a fifth cannot quietly skip it.
     | verified: yes
T560 | completed | the slotless pick: blended over history, and never disclosed
     | files: lib/signal-check/values.ts, value-engine.ts, types.ts, pipeline.ts,
     |        confidence.ts, builder-view.ts, freeze.ts, _test-kit.ts,
     |        pipeline.test.ts, trade-shape.test.ts,
     |        app/tools/signal-check/trade-result.tsx,
     |        components/signal-check-trade-card.tsx, docs/signal-check.md
     | Reported as "the import gets a different answer than typing the same trade
     | in by hand". It does, and most of the gap is not a bug: the builder only
     | offers slotted picks, Sleeper never says where a traded pick lands, so the
     | import blends early/mid/late. On the Syndicate's Olave trade the slot alone
     | swings it from Adiff by 23.5% (early) to Fair Trade (late), because at the
     | low end mjwalsh wins the quality comparison and collects a 3,115 credit.
     | Two real bugs underneath it:
     | - The blend averaged EVERY row the query returned, not the newest snapshot
     |   per bucket, so it mixed months of history into one number. Pick values
     |   have been falling, so this biased every imported pick upward: a 2027 1st
     |   priced 5,062 against a true 4,960, drifting further nightly. The query
     |   also read the whole table and hit the 1000-row cap (237 rows per
     |   season+round), so how much history existed decided which snapshots the
     |   blend even saw. Now scoped to the trade's seasons/rounds and averaged
     |   over the deduped latest per bucket.
     | - `assumed` was hardcoded false in the value engine with no code path
     |   setting it, so the "treat that pick as an estimate" note and the 8-point
     |   confidence penalty were dead on the one path where every pick is
     |   slotless. Renamed to blendedValue / hasBlendedPicks, wired to the
     |   resolver, and both surfaces now say the slot is unknown. The per-asset
     |   line reads "Draft pick, slot unknown" instead of "Draft pick".
     | Two regression tests: the flag fires only for a slotless pick, and the
     | early/late spread flips a verdict.
     | Not done, needs a product call: Sleeper's pick payload carries roster_id
     | (the pick's ORIGINAL owner), so the slot could be estimated from that
     | team's projected finish rather than blended. Done in T561.
     | verified: yes
T561 | completed | place a traded pick by projected finish instead of blending it
     | files: lib/league-pick-position.ts (new), lib/league-pick-position.test.ts (new),
     |        lib/signal-check/copy.ts (new), lib/league-signal-check.ts,
     |        lib/trade-finder-data.ts, lib/signal-check/{types,value-engine,pipeline,
     |        confidence,builder-view,freeze}.ts, lib/signal-check/rules/schema.ts,
     |        app/tools/signal-check/{import-actions.ts,trade-result.tsx},
     |        app/leagues/[league_id]/transactions/page.tsx,
     |        components/{signal-check-trade-card.tsx,player-profile/trades-tab.tsx},
     |        docs/signal-check.md
     | Where the league is known, a Sleeper-sourced pick is now placed in the
     | round rather than blended across it. Published draft order first
     | (league_drafts.slot_to_roster_id, via the EXISTING lib/league-pick-slots.ts,
     | which is a different thing: it returns the numeric 1.04 slot), projected
     | regular season finish second, blend last. Thirds of the league, keyed off
     | the pick's ORIGINAL team (draft_picks[].roster_id, often a third team, not
     | either side): top third sends late picks, bottom third early.
     | Proportional, so 12 splits 4/4/4 and 10 splits 3/3/4 with the remainder in
     | early. positionFromDraftSlot is the REVERSAL of positionFromProjectedFinish
     | rather than its own cut points; a test caught that independent floor() cuts
     | put the remainder at opposite ends and moved a team between buckets
     | depending on which source answered.
     | Verified on The Syndicate: Adiff projects 1st of 12, so their own 2027 1st
     | is a late pick, and the trade the bug report started from now grades Fair
     | Trade with a 15.2% adjustment on the import, matching what the same trade
     | built by hand already said.
     | Applied to the transactions feed, the player-profile trades tab, the
     | Sleeper import, and Trade Finder inside a league (which had been calling
     | every roster's own future picks "mid", pricing a contender's 1st and a
     | bottom team's 1st identically). NOT On The Clock and NOT the manual
     | builder: both send a slot the user chose and it must win.
     | Refuses rather than guesses when Power Pulse has not run, a projected win
     | total is missing, or every team projects identically.
     | An estimate is disclosed: "(late, projected)" on the asset line, a note
     | naming the rule, and -4 confidence (half the blend's -8).
     | verified: yes

### Review findings NOT fixed

- **An OTC snapshot finalized before T542 keeps a dynasty format_slug.** Snapshots
  are immutable by design and nothing re-derives them, so a continued redraft
  league whose draft was already locked shows dynasty values there while the
  live room now shows redraft. Same shape as the version 1 snapshot question in
  handoff.md, and the same decision to make.
- **draft-grade.ts curve parity is unverifiable.** The file is untracked, so the
  local zScores and surplusByRoster it used to reimplement exist nowhere in git
  history. `lib/power-pulse/math.ts stdev` is the SAMPLE formula; if the deleted
  local copy used the population formula, every curved component moved. Nothing
  in the repo can tell us which.
- **A concrete traded future pick still loses its holder on resolve.** The ref
  carries originalRosterId, not the current owner, so the which-side dialog has
  nothing to pre-select. Label and price are correct.
- **readDraftCache still runs in full on every pulse request** (~120 KB, and the
  pulse path reads three of its columns). The performance review names this the
  largest remaining server cost now that the projection board is memoized.
- **computeMarginal still runs 200-odd lineup solves per request** and is
  cacheable on (draft, roster, pick count), which nobody has tried.

## Beacon Steals: draft value against the market (2026-08-12)

Plan of record: `docs/beacon-steals-plan.md`. Read it first; it carries the data
audit, the two failure modes found by running the naive version against prod, and
the schema and math this task list implements.

Scope note from the owner: build everything EXCEPT a standalone `/tools` page.
The launch surface is the draft guide under `/guides`.

T562 | completed | write the Beacon Steals plan of record
     | files: docs/beacon-steals-plan.md
     | depends on: none
     | Full technical plan. Records the audit (7,552 On The Clock picks stored,
     | 99 completed League Pulse drafts with NO picks stored anywhere, Sleeper
     | ADP across 10 market keys, DynastyProcess rookie ADP back to 2023), the
     | two traps, the four migrations, the positional-currency math, confidence,
     | categories, ingestion, and the three surfaces.
     | The two traps are the reason the design is not "adp minus rank":
     |   1. Raw gap is largest exactly where both numbers are least reliable
     |      (top hits were all players past pick 230 in a 360-player market).
     |      Fixed by a confidence factor that decays with market and value depth.
     |   2. Overall rank is a CROSS-POSITION value rank and ADP is a SCARCITY
     |      price, so every QB in a 1QB format reads as a steal (6 of the top 12
     |      redraft PPR hits were QBs). Fixed by converting both sides to a pick
     |      ladder built from points above a replacement STARTER, which prices
     |      scarcity the same way a draft room does.
     | verified: n/a (planning artifact)

T563 | completed | canonical draft pick ledger (migration 0188)
     | files: supabase/migrations/0188_draft_selections.sql, lib/database.types.ts
     | depends on: T562
     | draft_selections: one row per pick in any draft we have ever synced, from
     | either path, with draft context (format_slug, player_pool, teams, rounds,
     | season) denormalized onto the row so the ADP build is one indexed scan.
     | Does NOT replace on_the_clock_pick_cache: that stays the live-room cache
     | and the Realtime source, and its rows get deleted on a commissioner
     | revert, which is exactly why a separate ledger is needed.
     | service_role ONLY, no client policies. Nothing client-side reads it, it
     | carries picked_by (a Sleeper user id) and the raw pick object, and every
     | consumer publishes its output instead. Verified in pg_policies.
     | Partial index on (format_slug, player_pool, season) where format_slug and
     | player_id are both non-null, which is the only shape the ADP build reads.
     | verified: yes (RLS confirmed, types regenerated)
T564 | completed | FF Beacon room ADP table (migration 0189)
     | files: supabase/migrations/0189_draft_market_adp.sql, lib/database.types.ts
     | depends on: T563
     | draft_market_adp: where OUR OWN synced rooms take each player, per
     | (format, pool, season). Mean, median, earliest, latest, stdev, and
     | draft_rate (picks_sampled / drafts_sampled).
     | draft_rate is the honest denominator. A player taken in 4 of 30 drafts
     | has a real ADP of "usually undrafted"; the mean over those 4 hides it.
     | Deliberately NOT blended into the published ADP. At current volume a
     | player has single-digit observations. It feeds ONE thing: the room
     | agreement confidence factor in the value model.
     | service_role only, derived table so no metadata column.
     | verified: yes (RLS confirmed)
T565 | completed | Beacon Steals model settings (migration 0190)
     | files: supabase/migrations/0190_draft_value_settings.sql, lib/database.types.ts
     | depends on: T562
     | Single pinned row id='global', same shape as league_power_pulse_settings
     | and on_the_clock_settings. Code fallbacks land in T567 so a missing row
     | degrades to a working model rather than an error.
     | Saving does not fan out a recompute; bumping modelVersion is what forces
     | the next nightly rebuild to rescore.
     | verified: yes (RLS confirmed, seed row inserted)
T566 | completed | Beacon Steals board table (migration 0191)
     | files: supabase/migrations/0191_draft_value_targets.sql, lib/database.types.ts
     | depends on: T563, T564, T565
     | draft_value_targets: per (format, season, player), the market side, the
     | FF Beacon side, the competitive side, and the output (value_gap,
     | steal_score, confidence, category, verdict).
     | beacon_pick is the load-bearing column and it is NOT overall_rank. The
     | table comment spells out why: overall_rank is a cross-position VALUE rank
     | and ADP is a SCARCITY price, so comparing them flags every QB in every
     | single-QB format. Measured on prod before writing any of this: six of the
     | top twelve raw-gap hits in redraft PPR were quarterbacks.
     | Sign convention matches lib/on-the-clock/adp.ts: positive value_gap means
     | taken later than expected, which is value. A number means the same thing
     | here and in the live draft room.
     | Public SELECT (the draft guide renders it) + service_role writes.
     | verified: yes (RLS confirmed, both policies present)
T567 | completed | the ledger writer (lib/draft-selections.ts)
     | files: lib/draft-selections.ts (new), lib/draft-selections.test.ts (new)
     | depends on: T563
     | One way in. shapeDraftSelections is PURE (picks + context + an already
     | resolved id map -> rows) and is the whole test surface, 13 cases.
     | recordDraftSelections does the I/O and NEVER THROWS: both callers sit on
     | a path a user is waiting on, and the ledger is analytics input.
     | Only one drop rule: a pick with no usable pick_no. An UNMAPPED player is
     | still stored with player_id null, because the raw Sleeper id is worth
     | keeping and the mapping can succeed later once the player row exists.
     | Duplicate pick_no inside one payload keeps the LAST, matching upsert
     | semantics, so a payload can never make Postgres reject the batch for
     | touching one key twice.
     | draftIdsWithSelections filters to pick_no = 1 on purpose. Selecting every
     | row for a set of drafts returns hundreds per draft and hits PostgREST's
     | silent 1000-row ceiling, which would report later drafts as unseen and
     | re-fetch them forever. One row per captured draft instead.
     | verified: yes (13/13 tests pass)
T568 | completed | both sync paths now feed the ledger
     | files: lib/on-the-clock/sleeper-sync.ts, lib/league-pulse.ts,
     |        lib/league-draft-selections.ts (new), lib/draft-selections.ts
     | depends on: T567
     | On The Clock: performDraftSync writes the ledger after its own cache is
     | consistent, inside its own try/catch. The id map it already built for the
     | pick cache is HANDED OVER rather than re-resolved, so the ledger costs no
     | extra player lookup. A null league object (failed fetch) stores a null
     | format; the next successful sync upserts the same rows with a real one,
     | so the gap self-heals instead of sticking.
     | Added epochMsToIso because Sleeper's draft start_time is epoch ms and
     | new Date(NaN).toISOString() throws a RangeError, which would have taken
     | the whole ledger write down on a malformed field.
     | League Pulse: capture runs in pulseLeagueDerived (the half that streams
     | in behind the page), NOT in the core path that paints the header.
     | The fetch policy IS the design. A completed draft never changes, so its
     | picks are worth exactly one Sleeper request ever:
     |   1. status='complete' only. Half a draft would poison an ADP with picks
     |      that have not happened.
     |   2. skip anything already in the ledger, checked in ONE query first.
     |   3. cap 5 drafts per run, 250ms apart. A decade-old dynasty league can
     |      have a dozen completed drafts and must not fan out twelve
     |      simultaneous Sleeper requests the first time anyone opens it.
     | Gated on force || resynced, so a cached load never touches Sleeper here.
     | getSleeperDraftPicksOrNull's null is respected: null (request failed,
     | retry later) is not collapsed into [] (Sleeper answered, no picks).
     | verified: yes (tsc --noEmit clean)
T569 | completed | one-time backfill of the pick ledger
     | files: scripts/backfill-draft-selections.ts (new), package.json
     | depends on: T568
     | npm run backfill:draft-selections. Two passes, and --skip-sleeper runs
     | pass A alone. NEVER wired to a cron; the sync paths keep it current now.
     | Pass A (no Sleeper traffic): on_the_clock_pick_cache -> ledger. Player ids
     | were already resolved at sync time, so the id map is built FROM THE CACHE
     | ROWS rather than re-queried.
     | Pass B: Sleeper -> ledger for completed league_drafts with no rows yet.
     | Format resolved once per LEAGUE, not per draft.
     | RESULT: 20,955 picks across 139 drafts, up from 7,552 with almost no
     | usable context. Pass B alone recovered 13,401 picks from 99 drafts that
     | existed nowhere in our database. 0 drafts unreachable.
     | First run classified only 6 of 40 On The Clock drafts, because
     | on_the_clock_draft_cache.league_metadata only arrived in migration 0180
     | and older cached drafts have a null. Added a fallback to the `leagues`
     | table by sleeper_league_id, which recovered 24 of the 34. Final coverage
     | 19,677 of 20,955 picks and 129 of 139 drafts carry a format.
     | Largest cohorts: dynasty-ppr-tep-sflex startup (28 drafts, 9,046 picks)
     | and dynasty-ppr-tep-sflex rookie (47 drafts, 2,306 picks).
     | verified: yes (run against prod, counts confirmed by query)
T570 | completed | FF Beacon room ADP (lib/draft-value/room-adp.ts)
     | files: lib/draft-value/room-adp.ts (new), lib/draft-value/room-adp.test.ts (new)
     | depends on: T564, T569
     | Aggregates the ledger into draft_market_adp. Pure aggregation, 16 tests.
     | Three things a naive average gets wrong, all fixed here:
     |   1. Pick numbers are normalized to a 12-team draft BEFORE averaging.
     |      Pick 24 is round 3 in a ten-team room and round 2 in a twelve, so a
     |      raw average silently rewards whoever drafts in smaller rooms. The
     |      transform is applied to the OFFSET from pick 1, not the pick number,
     |      so pick 1 stays pick 1 in every room size.
     |   2. Keepers are excluded from a player's own ADP but still count their
     |      draft toward the cohort denominator. A keeper is a roster already
     |      made, not a market decision.
     |   3. Auction drafts are dropped entirely. Pick order there is bid order.
     | draft_rate is published next to the mean because the mean hides its
     | denominator: 4 of 30 drafts means "usually undrafted".
     | Full replace per run with a stale prune, so a player who leaves a cohort
     | does not keep an ADP forever.
     | Result on prod: 2,672 players across 11 cohorts from 19,669 picks.
     | verified: yes (16/16 tests, run against prod)
T571 | completed | the scoring engine (lib/draft-value/engine.ts)
     | files: lib/draft-value/{engine,default-settings,settings,verdict}.ts (new),
     |        lib/draft-value/{engine,verdict}.test.ts (new),
     |        supabase/migrations/0192_draft_value_position_adjusted_gap.sql (new)
     | depends on: T565, T570
     | Pure. 75 tests across the three test files. Two of them are regression
     | guards named after the production failures they prevent.
     | A THIRD failure mode showed up during the build that the plan had not
     | anticipated, and finding it is why the fixture is grounded in a real
     | measurement rather than a guess.
     | 1. SCALE. The first version compared a ladder INDEX to an ADP. Those are
     |    not the same unit. A ladder over N players tops out at N while the
     |    market runs deeper, so every deep player reads as a huge steal purely
     |    because the ladder cannot produce a number that large. Measured: it
     |    made the QB artifact WORSE than the naive version it was fixing, 10 of
     |    the top 12 instead of 6. Fixed by projectOntoMarketScale, which takes
     |    the pick slots the market actually spent and hands them out in OUR
     |    order. beacon_pick is then literally "the pick he would go at if the
     |    room drafted the same players in our order", and both sides are the
     |    same unit by construction.
     | 2. POSITIONS. Even with the scarcity ladder, a points-above-replacement
     |    model wants elite QBs earlier than a 1QB room takes them. That is the
     |    long-running VOR-versus-market argument, not a per-player insight, and
     |    a steal list is the wrong place to relay it. Fixed by subtracting each
     |    position's MEDIAN gap before ranking (median, not mean, so a few
     |    genuinely mispriced players cannot drag the correction and hide
     |    themselves). Migration 0192 adds position_adjusted_gap to store it.
     |    value_gap stays the RAW arithmetic because that is what the verdict
     |    quotes and a reader can check it.
     | The engine.test.ts fixture reproduces the MEASURED per-position offsets
     | from prod (QB +26.6, WR +8.9, RB -0.5, TE -5.7 rank slots, redraft PPR),
     | and one test asserts the fixture reproduces the trap before another
     | asserts the engine removes it.
     | Projections are RESCORED per format, not read off a column. Sleeper emits
     | bonus_rec_te as the TE's projected reception count, so summing weekly
     | stat lines and taking the dot product against the format's canonical
     | scoring makes TE premium exact instead of an invented multiplier.
     | verified: yes (75/75 tests)
T572 | completed | build orchestrator + npm script
     | files: lib/draft-value/build.ts (new), scripts/calculate-draft-value.ts (new),
     |        package.json
     | depends on: T571
     | npm run calculate:draft-value. Two stages in order (room ADP feeds the
     | board's confidence input, so never in parallel).
     | Market ADP resolution reuses adpFormatKeyCandidates, the SAME ordered
     | fall-through the live draft room grades against, so a player's market
     | number cannot differ between the guide and On The Clock. A candidate key
     | carried by fewer than 50 players is treated as a partial write, not a
     | market.
     | A format with no rankings or no market is SKIPPED, never written empty.
     | An empty board is a bug; a missing board is a fact.
     | RESULT ON PROD: 4,136 rows across 8 formats. redraft-half-std and
     | redraft-std-std skipped, correctly: neither has FF Beacon rankings.
     | Per-position mean gap, raw -> centered, redraft-ppr-sflex:
     |   QB -29.4 -> -8.0, WR +17.2 -> +5.9, RB -5.4 -> -4.5, TE +2.3 -> +1.4
     | Top dynasty-SF steals are recognizable names rather than deep-board
     | noise: Chig Okonkwo, Jaylen Warren, Stefon Diggs, Parker Washington,
     | Josh Downs, Jayden Reed.
     | The three names the naive method put at the top all fell: Stribling to
     | 69 (confidence 0.37), Raridon to 62 and out of the steal bucket
     | (confidence 0.25), Caleb Douglas to 60 and out (confidence 0.20).
     | KNOWN LIMITATION, left in deliberately: centering uses the MEDIAN, so a
     | skewed position can still show a non-zero MEAN afterwards. Two cases on
     | prod (dynasty-ppr-std QB +15.2 raw -> +18.0 centered; redraft-ppr-tep TE
     | +0.7 -> -8.2). Using the mean instead would let a cluster of genuinely
     | mispriced players hide itself, which is the worse failure.
     | Fixed a copy bug caught by reading real output: the verdict said "63
     | picks later than he actually lasts" when he lasts 63 picks LONGER than
     | we would wait. Now "and he lasts 63 picks longer than that", with a test.
     | verified: yes (run against prod, output inspected by hand)
T573 | completed | nightly cron for the board
     | files: app/api/cron/rebuild-draft-value/route.ts (new), vercel.json,
     |        lib/cron-runs.ts
     | depends on: T572
     | 15:00 UTC, after every input it reads: recalculate-derived (10:00,
     | rankings + trends), sync-sleeper-market (11:00, ADP + projections),
     | sync-weekly-projections (12:00, the stat lines it rescores).
     | Does NOT iterate leagues. The board is global, one row per (format,
     | season, player), so it stays the same size at any traffic level.
     | Per-league work stays on demand per the CLAUDE.md rule.
     | Stage 1 (room ADP) is best-effort; stage 2 failing throws, and a run that
     | builds zero formats throws too, because leaving yesterday's board in
     | place is a silent staleness rather than a visible failure.
     | Registered in CRON_JOBS so the admin health panel shows it even before
     | its first run.
     | verified: yes (tsc clean, next build compiles the route)
T574 | completed | On The Clock reads the same board
     | files: lib/on-the-clock/board-types.ts, lib/on-the-clock/board-loader.ts,
     |        app/tools/on-the-clock/available-list.tsx,
     |        app/tools/on-the-clock/available-market-line.test.ts (new)
     | depends on: T572
     | The available-players ADP line used describeBeaconVsAdp, which compares
     | overall_rank to ADP. That is the exact unit error the engine exists to
     | fix, and it was live in the draft room.
     | loadRankedBoard now fetches draft_value_targets alongside rankings and
     | values (one more parallel query, no extra round trips), and
     | describeAvailableVsMarket prefers beacon_pick, which is already on the
     | market's pick scale. Copy went from "Sleeper ADP is 12 picks later" to
     | "Lasts 28 picks past our pick 92".
     | The old comparison is kept as the FALLBACK, not deleted: a format with no
     | ADP market, a kicker or defense (Beacon Steals ranks only QB/RB/WR/TE),
     | and any board loaded before the first nightly build all still get a line.
     | The room and the guide now read the SAME rows, so a player's verdict
     | cannot differ between them.
     | verified: yes (7 new tests, tsc clean)
T575 | completed | the draft guide (/guides/fantasy-football-draft-guide)
     | files: app/guides/fantasy-football-draft-guide/{page.tsx,steal-row.tsx} (new),
     |        lib/draft-value/guide-data.ts (new), lib/guides/published.ts,
     |        app/guides/page.tsx, app/api/og/guide/[slug]/route.tsx
     | depends on: T572
     | The launch surface, and the coming-soon card on /guides is now a link.
     | No year in the slug, same reasoning the glossary page documents: a dated
     | URL needs redirecting every August and the method does not expire even
     | though the names on it refresh nightly.
     | Format switching is a set of real ANCHORS carrying ?format=, not a JS
     | control. Works without JavaScript, keyboard navigable by default, every
     | format gets a shareable URL, aria-current="page" on the active one, and a
     | screen reader moves through it as the list of links it is.
     | Format resolution goes through resolveFormatSlug (URL -> DB -> cookie ->
     | default) per the sync rule. A saved format with no ADP market falls
     | through to one that has a board and SAYS SO, without persisting the swap.
     | Rows are stacked blocks, not table rows, specifically so the mobile
     | layout carries every number the wide one does. There is no `hidden sm:`
     | in steal-row.tsx.
     | The verdict paragraph sits ABOVE the numbers and is the primary content,
     | so the page reads the same by ear as by eye. Confidence renders as a word
     | (high / solid / moderate / thin) because a bare 0.37 means nothing.
     | Registered in PUBLISHED_GUIDES so the sitemap and llms.txt pick it up,
     | and given an OG card entry (a slug with no card 404s by design).
     | verified: yes (next build compiles it, tsc clean)
T576 | completed | admin editor (/admin/draft-value)
     | files: app/admin/draft-value/{page.tsx,actions.ts,
     |        draft-value-settings-manager.tsx} (new),
     |        lib/draft-value/validate.ts (new), components/admin-nav.tsx
     | depends on: T571
     | Mirrors /admin/power-pulse. requireAdmin on both the page and the action;
     | the client payload is never trusted and must pass the full zod schema
     | before it is written through the service-role client.
     | validate.ts also catches the configurations that PARSE but produce
     | nonsense: an inverted reliability or room-agreement band, a steal
     | threshold above the saturation point (nothing could ever qualify), a
     | swing threshold above the steal threshold (unreachable bucket), flex
     | shares summing past one whole slot, an all-zero blend, and a market
     | trusted depth so far past the value depth that the confidence decay is
     | effectively switched off.
     | The page shows a live board summary (rows, buckets, last rebuilt, model
     | version) so tuning is not blind, with the timestamp through formatEastern.
     | verified: yes (tsc clean, next build compiles the route)

### Verification (Beacon Steals)

- `npx tsc --noEmit` clean.
- `npx vitest run`: 1605 tests across 116 files pass (98 of them new here).
- `npx next build` compiles clean, including the new guide, admin, and cron routes.
- Migrations 0188 to 0192 applied to prod; RLS confirmed in pg_policies.
- `npm run backfill:draft-selections` run against prod: 20,955 picks, 139 drafts.
- `npm run calculate:draft-value` run against prod: 4,136 rows, 8 formats.
- Nothing committed or pushed.

### Review pass (four sub-agents, same session)

Implementation, security, performance, and accessibility, each scoped to the
Beacon Steals files only. Security found no vulnerabilities and verified RLS
live against prod with rollback-wrapped probes. The other three found real
problems and every confirmed finding below is fixed.

T577 | completed | apply the review findings
     | files: supabase/migrations/0193_draft_value_board_formats_and_capture_state.sql (new),
     |        lib/draft-value/{build,engine,verdict,guide-data,room-adp}.ts,
     |        lib/draft-selections.ts, lib/league-draft-selections.ts, lib/sleeper.ts,
     |        lib/on-the-clock/{board-loader,sleeper-sync}.ts,
     |        app/guides/fantasy-football-draft-guide/{page.tsx,steal-row.tsx},
     |        app/guides/page.tsx, app/admin/draft-value/{page.tsx,
     |        draft-value-settings-manager.tsx}, app/tools/on-the-clock/available-list.tsx,
     |        lib/database.types.ts, plus tests
     | depends on: T576
     |
     | THE ONE THAT MATTERED MOST: category and verdict contradicted each other,
     | live on prod. Nine rows were category='steal' with a NEGATIVE raw
     | value_gap, because the board ranks on position_adjusted_gap while the
     | sentence quotes value_gap. Brock Purdy, going at 36.2 against our pick
     | 40.1, rendered under a Steals heading carrying "the room is spending 4
     | picks too early on him". Both numbers were right; neither explained the
     | other. The verdict now adds the missing clause whenever the two diverge:
     | "The room drafts every QB in this format about 21 picks earlier than our
     | board does, so against the rest of the position he is 18 picks of value."
     |
     | Reading that fixed output surfaced a SECOND bug the review had not
     | caught. Kirk Cousins, going at pick 238 and projecting 182 points BELOW a
     | replacement starter, was also a steal, lifted there purely by positional
     | centering. categorize now requires a steal to have either positive points
     | above replacement or none measured (a rookie, where the value board is
     | the whole case). That is the same test the swing bucket already used.
     | Verified: 0 steals below replacement, down from 9 contradictory rows.
     |
     | PERFORMANCE. The nightly build read the whole (format, ffbeacon)
     | player_value_history ordered by captured_at desc to recover the latest
     | value per player: 60,652 rows and 61 round trips per format to get 805
     | values, 32MB of JSON across eight formats, and growing 779 rows per
     | format per day forever. It was on track to blow the 300s cron ceiling
     | inside a year. Replaced with player_value_trends.current_value, which is
     | one row per (player, format, source) and is what CLAUDE.md's Pre-Calc
     | rule says to read. The old code also swallowed a read error with
     | an `if (error) break`, producing a board where every value was null and
     | the ladder silently fell back to ranking by negative beaconRank; it
     | throws now.
     | MEASURED: board build 48.3s to 11.1s, and flat as the database ages.
     | Also hoisted the market snapshot above the format loop (it never depended
     | on the format: 5,400 rows fetched to learn 675 rows' worth), and cut the
     | admin summary from a 5,000-row read to count aggregates.
     |
     | CORRECTNESS. Every draft_value_targets read was missing the season
     | filter, while the build's prune is season-scoped by design, so next
     | August two seasons would have interleaved silently. Added a distinct
     | view (0193) because `.limit(5000)` never defeated PostgREST's 1000-row
     | cap: the format switcher and the admin counts were already truncating.
     | Published buckets had no tiebreak on an integer, heavily-tied score, so
     | the top 12 reshuffled between page loads.
     | The stale prune deleted every format's rows on one format's transient
     | failure, and the cron still reported success. Now scoped to built slugs.
     | Room-agreement confidence gated on drafts_sampled (a property of the
     | COHORT) instead of picks_sampled (the player). 127 rows had the gate open
     | on a single observed pick.
     | The room-ADP prune only ran when the run produced rows, so an empty run
     | left the table stale indefinitely.
     |
     | LIVE DRAFT PATH. recordDraftSelections re-upserted the whole pick array
     | on every poll: roughly 130,000 row writes over a two-hour draft to
     | persist 180 picks, each carrying a raw Sleeper object. Now writes only
     | picks above the previously stored count, and skips the two format-lookup
     | queries entirely when the league object failed to load.
     | League Pulse retried uncapturable drafts forever, because "pending" meant
     | "no ledger rows" and a reset draft never gets any. 0193 adds
     | picks_captured_at and pick_capture_attempts so a definitive answer stops
     | the asking and a failure retries a bounded number of times.
     |
     | SECURITY (hardening only; no vulnerabilities found). isValidDraftId now
     | enforced in shapeDraftSelections, where BOTH callers pass through, and
     | getSleeperDraftPicksOrNull encodes its path segment like its sibling
     | getSleeperMatchups already did.
     |
     | ACCESSIBILITY. role="list" on the ranked board: Tailwind preflight
     | removes list-style, Safari/VoiceOver then drops list semantics, and the
     | visible rank number is aria-hidden, so nothing was left telling a screen
     | reader this was a ranked list or where a player sat in it.
     | text-ink-subtle (#6B6B7D) measures 3.68:1 on these surfaces and fails
     | WCAG 1.4.3 AA. It was carrying every stat label and every admin form
     | label, so the value read at 17.5:1 and the word explaining it at 3.68:1.
     | Moved to text-ink-muted (8.6:1).
     | The h1 aria-label said something different from the visible text.
     | The Gap pill read "+14", and screen readers drop a leading plus sign at
     | default verbosity, so the sign (the entire meaning) was inaudible. Now
     | words: "14 picks later" or "14 picks earlier".
     | Admin field hints are tied to their inputs with aria-describedby, the
     | eight setting groups are labelled regions, a save failure announces as an
     | alert, and the save button uses aria-disabled so Chrome does not throw
     | keyboard focus to body mid-save. Null stat pills are dropped rather than
     | reading "Goes at unknown". The player link now clears the 44px floor.
     | verified: yes (tsc clean, 1612 tests across 116 files, next build clean,
     | board rebuilt against prod and inspected by hand)

### Review findings deliberately NOT fixed

- **Rookie-pool boards.** Room ADP builds rookie cohorts and the ADP key mapping
  supports them, but the board only builds the `everyone` pool, so the
  DynastyProcess branch of `marketLabel` is unreachable. Recorded in the plan's
  deferred section rather than deleted, because `selectMarketAdp` now takes a
  pool argument and the wiring is one call away once someone decides what a
  rookie-draft section should say.
- **Caching the guide page.** Five index-backed reads per request, the bucket
  read measures 2.9ms, and the page has to stay dynamic anyway because
  resolveFormatSlug reads cookies.
- **SQL-side room ADP aggregation.** 21,000 rows into memory is fine today.
- **backfill:draft-selections is not in `backfill:all`.** It hits Sleeper and is
  a one-time recovery, so it stays out. CLAUDE.md says backfill:all runs every
  backfill script; one of the two should change, and that is the owner's call.
- **text-ink-subtle is failing AA everywhere, not just here.** Fixed in the new
  files. Raising the token itself is a site-wide change and out of this scope.
- **aria-describedby and aria-disabled are also missing in
  app/admin/power-pulse.** The Beacon Steals form inherited both from it. Fixed
  here only; the older form is untouched.

T578 | completed | make the guide's player cards read as players
     | files: app/guides/fantasy-football-draft-guide/steal-row.tsx,
     |        app/guides/fantasy-football-draft-guide/steal-row.test.ts (new),
     |        app/guides/fantasy-football-draft-guide/page.tsx,
     |        lib/draft-value/guide-data.ts
     | depends on: T577
     | Owner feedback: the cards read as paragraphs with numbers in them, not as
     | players, and the numbers were not doing enough work.
     | Card now leads with a 56px headshot (PlayerHeadshot, the shared component,
     | so the radius rule holds), the name at text-lg/xl, the position in its own
     | POSITION_BADGE hue, the team abbreviation on the team's own brand color,
     | the full team name, and the category badge.
     | The argument is now the biggest thing on the card: "Goes at" and "We'd
     | take" as 3xl/4xl tabular figures in a recessed panel, with the swing
     | between them spelled out underneath ("Lasts 36 picks longer than we would
     | wait"). Supporting stats moved to a 2-up/3-up tile grid.
     | Also fixed the summary card rendering black text: it used bg-white/[0.03],
     | a near-transparent wash that takes whatever is behind it. Now an opaque
     | #16162A panel inside the beacon gradient border, matching the same block
     | on /guides/fantasy-football-terms, which had already been written that way
     | for the same reason.
     | guide-data now also selects players.external_ids (for the Sleeper CDN id)
     | and joins nfl_teams once per page for name + primary_color.
     | readableAccent lifts a near-black team color until it clears a minimum
     | perceived brightness. Pittsburgh is #101820 and Washington is #5A1414;
     | painted onto a #0F0F1A surface both vanish, so the accent would silently
     | disappear for several teams. Blends toward white in small steps so the
     | hue survives, and refuses a malformed value rather than emitting broken
     | CSS. 6 tests.
     | Accessibility held: no `hidden sm:` anywhere in the file, the sign of
     | every figure is spelled out rather than relying on a leading plus that
     | screen readers drop, color is never the only channel (the position hue
     | sits behind the position's own letters, the team color behind its own
     | abbreviation), the name link keeps its 44px target, and the verdict
     | paragraph is still the primary content.
     | verified: yes (tsc clean, 1618 tests across 117 files, next build clean)

T579 | completed | guide visuals + tier-based drafting explainer
     | files: app/guides/fantasy-football-draft-guide/{page.tsx,steal-row.tsx},
     |        app/guides/page.tsx
     | depends on: T578
     | Owner feedback, four items.
     | 1. Section titles. New SectionHeader: a beacon gradient rule across the
     |    full width, a colored eyebrow naming the kind of section, then the
     |    heading at text-3xl/4xl (was text-2xl). Cyan for the board sections,
     |    purple for the prose ones. Rule and eyebrow are aria-hidden; the
     |    heading still carries the meaning and is what aria-labelledby points at.
     | 2. Stat tiles now match the player profile: font-mono, bold, tabular,
     |    text-brand-purple on a purple-tinted card with a purple border, same
     |    treatment as overview-sidebar.tsx and weekly-projections.tsx, so a
     |    number reads the same way everywhere on the site.
     | 3. Removed the redundant plain-text full team name. The abbreviation tag
     |    stays and is now aria-hidden, with the full team name as sr-only text
     |    inside the same tag: the eye gets "WAS", the ear gets "Washington
     |    Commanders". Dropping the name outright would have left a screen reader
     |    with three unexplained letters.
     | 4. New "Tier-based drafting, explained properly" section, six subsections.
     |    RESEARCHED, not written from memory: The Fantasy Footballers' tiered
     |    rankings guide, FantasyPros' 2026 tiers strategy piece, Lindy's and
     |    Athlon's beginner explainers, and Yahoo's positional-scarcity primer.
     |    The two load-bearing ideas every source converges on are the ones the
     |    section is built around: a tier break is a cliff you should not cross,
     |    and counting the names left in a tier is what tells you whether you can
     |    wait. Also covers the positional run (the most common way a draft gets
     |    away from someone), why scarcity is not a reason to reach, and that
     |    tier numbers do not transfer across positions.
     |    Metadata, keywords, and the /guides card bullets updated to match.
     | Writing check: scanned both files at byte level, zero characters above
     | U+007E. One fix from the first draft: "Not 'take the highest ranked
     | player', but 'which cliff...'" was a contrastive construction close
     | enough to negative parallelism to be worth rewriting; it now reads "The
     | question stops being which player is ranked highest and becomes which
     | cliff you are about to fall off."
     | verified: yes (tsc clean, 1618 tests across 117 files, next build clean)

T580 | completed | compact the On The Clock ADP and projection columns
     | files: components/info-tooltip.tsx, app/tools/on-the-clock/available-list.tsx
     | depends on: T574
     | Owner feedback: the full sentences under the ADP and projection numbers
     | squeezed the whole available-players table.
     | Added ValueTooltip alongside the existing InfoTooltip, sharing its proven
     | open/close wiring but using the VALUE ITSELF as the trigger instead of an
     | info icon. Hover, keyboard focus, and tap all open it; Escape and outside
     | click close it.
     | ADP column is now the number plus a chip like (+28). Projection column is
     | the number plus (53%). Both color coded: emerald when it favours the
     | reader, rose when it does not, grey inside the neutral band.
     | NO aria-live region, deliberately. The full sentence is the trigger
     | button's aria-label, so a screen reader speaks it the moment the control
     | takes focus, whether or not the bubble is painted. That is the contract
     | InfoTooltip already uses. A live region on open would say the same
     | sentence twice, once from the label and once from the region.
     | Color is never the only channel: the sign is inside the chip text and the
     | direction is stated in words in the label. Trigger keeps a 44px target.
     | Beat-rate bands are not 50/50, because league-wide a player beats his own
     | weekly projection about a third of the time (measured: mean beat_rate
     | 0.322 to 0.353 across scoring bases in player_projection_accuracy). So
     | 45% and up is green and 28% and below is red.
     | verified: yes (tsc clean, 1618 tests across 117 files, next build clean)

T581 | completed | tighten the On The Clock player column
     | files: app/tools/on-the-clock/available-list.tsx
     | depends on: T580
     | Player cell is now a 32px headshot beside a two-line stack: name on top,
     | position and team (and Rookie) underneath. Previously those ran inline
     | after the name and stretched the column.
     | Photo is decorative (name="" on PlayerHeadshot) because the name sits
     | immediately beside it, so a screen reader is not told the name twice.
     | Tier cell renders "T1" visually with "Tier 1" as sr-only text, so the
     | column narrows without the cell reading as a bare letter and number.
     | verified: yes (tsc clean, 1618 tests across 117 files, next build clean)

T582 | completed | write the draft-signal rationale engine
     | files: lib/on-the-clock/rationale.ts, lib/on-the-clock/rationale.test.ts
     | depends on: T581
     | Pure module that turns a recommendation into plain-English argument cards
     | plus one caveat. Separate from recommend.ts because every sentence needs
     | facts the scorer never sees (real positional finishes, ADP, picks until
     | your next turn, who a pick displaces), and because copy changes far more
     | often than scoring does.
     | Five lenses: value and market, lineup impact, cost of waiting, how the
     | pick fits the league and the build, and what the player has actually
     | finished. Capped at 4 per card. Team Need leads with the lineup and the
     | clock; Best Available leads with the board and the market.
     | Rules the copy holds to: name the number, never claim what was not
     | measured, never describe our own outage as a fact about the player, call
     | the league what it actually is, and write for the ear (no parenthetical
     | asides, no untranslated jargon, verb before any long clause).
     | Sample gates are explicit. A beat rate under 4 graded weeks reports the
     | rate and withholds the verdict; youth is only asserted when the engine's
     | own position-adjusted youthScore agrees.
     | verified: yes (tsc clean, 1647 tests across 118 files, next build clean)

T583 | completed | load season finishes for the recommended players
     | files: lib/on-the-clock/player-brief.ts,
     |        app/api/on-the-clock/player-brief/route.ts,
     |        lib/on-the-clock/client.ts
     | depends on: T582
     | Reads player_positional_finishes (the nightly cache behind the player
     | profile) for up to 4 player ids in the format's own scoring, so a finish
     | means the same thing in a draft room as it does on a profile page.
     | Deliberately NOT part of the board load: that carries ~800 players and
     | would move tens of thousands of rows to render six numbers.
     | Route follows the board route exactly: x-requested-with guard, feature
     | gate, force-dynamic, private no-store, fixed error strings. ids param is
     | length-capped before splitting and UUID-filtered; unknown format is a 400
     | rather than a silent PPR default. A failed read throws so the route can
     | answer 503, because swallowing it into an empty brief made an outage look
     | like "this player has never scored a point" and got cached as such.
     | verified: yes (RLS confirmed public SELECT on player_positional_finishes,
     |           security review clean, tsc clean, 1647 tests, next build clean)

T584 | completed | rebuild the two draft-signal spotlights
     | files: app/tools/on-the-clock/player-spotlight.tsx,
     |        app/tools/on-the-clock/on-the-clock-client.tsx
     | depends on: T583
     | Team Need was a single line of name, position rank and value with no
     | reasoning attached. It is now a full peer of Best Available.
     | Both cards carry a six-tile stat rail (FF Beacon value, position rank and
     | tier, projected points a week with season points left, beat rate with its
     | graded-week sample, market ADP against our own beacon_pick, availability),
     | the rationale cards, a season-finish strip, and the caveat.
     | Absent numbers are spoken as reasons, never left as a bare dash.
     | Accessibility: sr-only card label prefixes the h3 so the two cards are
     | tellable apart in a heading list; finish chips are aria-hidden with their
     | own sr-only sentence rather than an aria-label on a bare li; shortLabel
     | shortens pixels only and the full label is always what is announced;
     | ink-subtle replaced with ink-muted on every data-bearing label (3.7:1 to
     | 8.3:1); no data hidden at any breakpoint (grid-cols-2 sm:grid-cols-3).
     | The finish-loading line is deliberately NOT a live region: the card
     | recomputes on every pick and would talk over the alert announcer.
     | verified: yes (tsc clean, 1647 tests across 118 files, next build clean)

T585 | completed | make the rationale copy format-aware
     | files: lib/sleeper-to-format.ts, lib/on-the-clock/types.ts,
     |        app/api/on-the-clock/leagues/route.ts, lib/on-the-clock/recommend.ts,
     |        lib/on-the-clock/rationale.ts, app/tools/on-the-clock/fixtures.ts,
     |        app/tools/on-the-clock/on-the-clock-client.tsx
     | depends on: T584
     | The card told dynasty drafters "This is a keeper league". DerivedFormat's
     | league_type folds keeper into redraft because keeper leagues PRICE off the
     | one-year board, so it cannot name a league on its own.
     | Added deriveKeeperStyle (Sleeper type 2 dynasty, 1 keeper, 0 and 3
     | redraft) and carried it on LeagueCard as keeperStyle, separate from the
     | format slug. All three now get their own copy, and none is told it chose
     | a build mode it was never offered.
     | recommend() now returns superflex and tep so the copy can explain why a
     | quarterback is priced the way he is here without re-deriving it from the
     | slug (a SUPER_FLEX league counts even when its closest format is 1QB).
     | The one-quarterback note is confined to Best Available: on a Team Need
     | card that named QB as the open slot it argued against the pick beside it.
     | verified: yes (tsc clean, 1647 tests across 118 files, next build clean)

T586 | completed | move the mobile side rail into a bottom sheet
     | files: app/tools/on-the-clock/sidebar-sheet.tsx, components/bottom-sheet.tsx,
     |        app/tools/on-the-clock/dashboard-panels.tsx,
     |        app/tools/on-the-clock/on-the-clock-client.tsx
     | depends on: T585
     | Below xl the rail used to stack under the whole page, so its four panels
     | sat past the entire board. They now live in a slide-up sheet behind a
     | full-width bar directly under the view tabs, on every tab including the
     | two that hide the desktop rail.
     | The bar re-docks under the site header once scrolled past and lets go at
     | the same point on the way back up. IntersectionObserver on the bar's own
     | slot, not position:sticky: the room shell's overflow-hidden turns sticky
     | into static. The slot keeps its height so the page never jumps, and the
     | docked inset matches the flow inset so the bar does not jump either.
     | The dock trigger is computed from the root font size rather than assuming
     | 16px per rem, so it stays correct at a larger browser default.
     | railInSheet is a real media query, not a hidden xl:block class: several
     | panels carry fixed DOM ids and display:none leaves the duplicates in the
     | document. BestRemainingByPosition gained instanceId for the board view's
     | second copy.
     | BottomSheet gained hideAboveClass (default md:hidden, unchanged for its
     | two existing callers), motion-reduce on both the panel and the backdrop,
     | and a document-connected check before restoring focus.
     | The sheet's onClose is a stable useCallback: a fresh closure per render
     | re-ran BottomSheet's focus-and-scroll-lock effect on every realtime pick,
     | which moved focus twice a pick for as long as the sheet stayed open.
     | verified: yes (tsc clean, 1647 tests across 118 files, next build clean)

T587 | completed | apply the four review passes on T582 through T586
     | files: lib/on-the-clock/rationale.ts, lib/on-the-clock/rationale.test.ts,
     |        lib/sleeper-to-format.ts, lib/on-the-clock/types.ts,
     |        app/api/on-the-clock/leagues/route.ts, app/tools/on-the-clock/fixtures.ts,
     |        app/tools/on-the-clock/sidebar-sheet.tsx, components/bottom-sheet.tsx,
     |        app/tools/on-the-clock/dashboard-panels.tsx,
     |        app/tools/on-the-clock/draft-radar.tsx,
     |        app/tools/on-the-clock/on-the-clock-client.tsx
     | depends on: T586
     | Implementation, accessibility, security and performance reviews were run
     | against the two rounds. Security found nothing. What the other three
     | found and what changed:
     | The build point sat fifth of five on the Team Need card with a cap of
     | four, so the sentence naming the drafter's league was the one being cut
     | on the card most drafters act on. Reordered so track record is last on
     | both cards: the finish strip and the beat-rate tile carry that data
     | elsewhere, and the league type appears nowhere else.
     | Worst-case build body was 88 words in one unbroken paragraph. The
     | projection sentence is now dropped whenever a format sentence earned its
     | place (the number is in a tile a few inches up), and the two longest
     | sentences were cut down. Worst case is now three sentences.
     | The keeper fix was incomplete: keeper leagues were being told they were
     | one-year leagues. deriveKeeperStyle now carries Sleeper's type through
     | LeagueCard.keeperStyle, and all three league types get their own copy.
     | BottomSheet's focus-and-scroll-lock effect keys on the onClose identity,
     | and SidebarSheet was passing a fresh closure every render. In a live
     | draft that re-ran the effect on every pick, moving focus twice a pick and
     | rewriting document.body.style.overflow twice a pick for as long as the
     | sheet stayed open. onClose is now a stable useCallback.
     | mounted.current was cleared on unmount but never set on mount, so React
     | Strict Mode's development double-mount left it false and every season
     | finish response was dropped for the rest of the dev session.
     | scroll-padding-top of 8.5rem is set on the document while the mobile bar
     | is mounted, so no focused control lands under the docked bar (WCAG 2.4.11
     | Focus Not Obscured). One declaration covers every focusable in the room.
     | The dialog is now named by its own visible h2 via labelledBy rather than a
     | duplicate hidden span, and the summary line is aria-hidden because it is
     | the tail of the trigger's accessible name. "Quick info" was being spoken
     | three times and the summary twice.
     | Dropped aria-expanded from the trigger: it is a disclosure property and
     | this opens a modal, so screen readers were announcing "collapsed" about
     | content that never expands in place.
     | The four rail panels take a headingLevel and render at h3 inside the
     | dialog, so the outline reads as a container with four panels rather than
     | five peers. DraftRadar shifts its three subsection headings with it.
     | The dock trigger is computed from the root font size instead of assuming
     | 16px per rem, and the docked bar's horizontal inset matches its in-flow
     | inset so it no longer jumps 17px left on detaching.
     | BottomSheet also gained: a document-connected guard before restoring
     | focus, form fields in the focus-trap selector, and motion-reduce on the
     | backdrop as well as the panel.
     | The one-quarterback note is confined to Best Available, LeagueShape.label
     | was removed as dead, and xl:scroll-mt-24 keeps the tab scroll margin
     | honest at widths where the bar does not exist.
     | verified: yes (tsc clean, 1650 tests across 118 files, next build clean,
     |           all-ASCII scan clean across every changed file)

T588 | completed | BEAM schema: player search columns, aliases, query log, requests, settings
     | files: supabase/migrations/0194_beam_player_search_name.sql,
     |        supabase/migrations/0195_beam_player_aliases.sql,
     |        supabase/migrations/0196_beam_queries.sql,
     |        supabase/migrations/0197_beam_learning_requests.sql,
     |        supabase/migrations/0198_beam_settings.sql,
     |        supabase/migrations/0199_beam_search_players_rpc.sql,
     |        lib/database.types.ts
     | depends on: none
     | players gains two stored generated columns, search_name and
     | search_last_name, plus a GIN trigram index and two btree indexes. The
     | expressions rebuild from first_name/last_name because full_name is itself
     | generated and Postgres forbids one generated column referencing another.
     | beam_player_aliases is the editorial nickname map (122 seeded), public
     | SELECT. beam_queries is the question log, beam_learning_requests the
     | feedback queue, beam_settings the single pinned config row: all three
     | service-role only with no client policies. beam_search_players is a
     | SECURITY INVOKER RPC for trigram matching, which PostgREST cannot express;
     | grants named against all three roles, not just public.
     | verified: yes (policies queried from pg_policies, anon read tested per
     |           table under begin/rollback, types regenerated via MCP)

T589 | completed | BEAM engine: interpreter, resolver, stat registry, capabilities
     | files: lib/beam/types.ts, lib/beam/default-settings.ts, lib/beam/settings.ts,
     |        lib/beam/clock.ts, lib/beam/context.ts, lib/beam/engine.ts,
     |        lib/beam/validate.ts, lib/beam/log.ts, lib/beam/examples.ts,
     |        lib/beam/interpret/{normalize,tokens,trie,lexicon,entities,score,index}.ts,
     |        lib/beam/resolve/{distance,player}.ts,
     |        lib/beam/stats/{registry,query}.ts,
     |        lib/beam/answers/{format,templates}.ts,
     |        lib/beam/capabilities/*.ts, lib/beam/interpret/interpret.test.ts,
     |        scripts/beam-smoke.ts
     | depends on: T588
     | The seam is BeamRequest: the interpreter is the only component that sees
     | raw text, and capabilities take validated params plus resolved ids. That
     | is what makes the future LLM layer one new file implementing
     | BeamInterpreter rather than a rewrite.
     | Eight capabilities: season stat, stat line, compare stat, compare verdict
     | (which calls the real Beacon Breakdown stack rather than reimplementing a
     | verdict), value, rank, bio, glossary term.
     | Player resolution is five tiers plus a fuzzy tier, grouped so only the
     | best tier competes. First and last name share one tier at one confidence
     | on purpose: "brock" is Kevin Brock's surname and Brock Purdy's given name,
     | and ranking surnames higher would confidently answer with a backup tight
     | end. Uniqueness decides, so "purdy" answers and "brock" asks.
     | Intent routing has no margin gate. Candidate readings are TRIED in order
     | and the first that can be built wins, so "what is faab" fails at player
     | resolution in microseconds and answers as a definition.
     | verified: yes (tsc clean, 36 new tests, 1686 total across 119 files,
     |           smoke run against production data across 24 real questions)

T590 | completed | BEAM public surface: /tools/ask-beam and the two API routes
     | files: app/api/beam/ask/route.ts, app/api/beam/learn/route.ts,
     |        app/tools/ask-beam/{page,ask-beam-client,beam-answer-card,
     |        beam-clarify,beam-unsupported,beam-learn-form}.tsx,
     |        components/beam/beam-mark.tsx, lib/email/beam-emails.ts
     | depends on: T589
     | The ask route is transport only: same-origin header, length cap before
     | parsing, durable per-actor rate limit that fails closed. The learn route
     | copies /api/guide/submit exactly: full origin check, honeypot, validation,
     | rate limit, after() for email. It re-reads the question from the logged
     | row rather than trusting the body, so a submission cannot be filed against
     | someone else's question.
     | One visually-hidden aria-live region carries the announcement; the
     | transcript is deliberately not live, because a live transcript announces
     | every fact grid in visual order.
     | verified: yes (tsc clean, next build clean, both routes present)

T591 | completed | BEAM admin, site wiring, and the Signal Guide page
     | files: app/admin/beam/{page,actions}.ts(x),
     |        app/admin/beam/{gaps,requests,aliases}/page.tsx,
     |        components/admin/beam-{settings,requests,aliases}-manager.tsx,
     |        lib/beam-admin-nav.ts, components/admin-nav.tsx, lib/site.ts,
     |        app/tools/page.tsx, app/sitemap.ts, lib/guide/registry.ts,
     |        supabase/migrations/0200_signal_guide_ask_beam.sql
     | depends on: T590
     | Four admin surfaces: settings, the unanswered-question list grouped by
     | normalized question, the learning-request queue, and the nickname editor.
     | Every server action re-checks requireAdmin itself.
     | The unanswered list is the loop that matters: read what people typed that
     | BEAM could not place, add it to the nickname map, done.
     | Nine Signal Guide entries seeded so the tool explains itself in place.
     | verified: yes (tsc clean, next build clean, guide page seeded with 9 entries)

T592 | completed | apply the four review passes on T588 through T591
     | files: supabase/migrations/0201_beam_review_fixes.sql, lib/beam/**,
     |        app/api/beam/**, app/tools/ask-beam/**, app/admin/beam/**,
     |        components/admin/beam-*.tsx, lib/email/beam-emails.ts,
     |        app/api/cron/recalculate-derived/route.ts,
     |        lib/guide/registry.test.ts
     | depends on: T591
     | Implementation, security, accessibility and performance reviews were run.
     | Everything they found that was real is fixed. The ones that mattered:
     | 48 seeded aliases were just the player's own surname. An alias outranks
     | the algorithmic surname tier, so "cook" answered for James Cook with six
     | other Cooks in the table and never asked. All 48 deleted, and the admin
     | editor now refuses a surname alias with the reason.
     | The comparison capability and the sentence template kept SEPARATE lists of
     | which stats are better when lower. They disagreed about points allowed, so
     | the answer named the right team with the wrong verb. One flag on the
     | registry now feeds both.
     | lookupDirect had an unordered LIMIT 60 over a set that reaches 81 rows for
     | "williams". Dropping the exactly-matching row silently skipped the exact
     | tier and let a different Williams answer at 0.88. Ordered, cap raised.
     | sum and combine reported a column that was null every week as a measured
     | zero, so a receiver with no air-yards coverage was told he recorded none.
     | Team defenses were unanswerable: the team vocabulary claims "ravens"
     | before name spans are built, so every capability disqualified itself.
     | Teams now count as subjects and become the name span.
     | def_int and target_share were removed after checking production: the
     | interceptions column is 0 on all 544 DEF rows and target_share is null on
     | all 283k. A stat that can only answer zero is worse than not offering it.
     | beam_search_players carried SET search_path, which blocks inlining, so it
     | was planned per call: 5.4ms warm and 43-62ms cold against 1.3ms inlined.
     | Dropped and schema-qualified instead. Also capped p_query at 80 chars: it
     | is anon-executable and a 1MB query cost 750ms against 5ms for a real name.
     | The ask route claimed its rate-limit slot AFTER building the request
     | context, so a throttled caller still cost a Sleeper call and six reads.
     | The learn route stored an unsalted sha256 of the IP next to a name and an
     | email. The IPv4 space is enumerable, so that hash is reversible. It now
     | stores the salted actor key, and it binds a queryId to the actor who
     | actually asked it before adopting that question.
     | cleanup_beam_queries existed but nothing called it; three comments claimed
     | it was wired. Now in the nightly recalculate-derived prune, using the
     | admin-configured retention window rather than the SQL default.
     | Accessibility: disabling the textarea while busy unfocused it and dropped
     | focus to body after EVERY turn, and the restore was a no-op because the
     | control was still disabled when it ran. Errors were announced twice, once
     | assertively. The answer was spoken twice, once as prose and again as the
     | fact grid. Position codes read as "W R" and "Q B, S F". The matched-player
     | line and the dead-end exits were announced zero times. Each turn now has
     | an h2 so heading navigation reaches every answer.
     | Resolution was re-run per candidate reading, up to 32 round trips for a
     | two-player question; memoised per interpret call.
     | verified: yes (tsc clean, 1691 tests across 120 files, next build clean,
     |           all-ASCII scan clean across 62 files, RLS re-verified as anon,
     |           30-question smoke run against production data)

T593 | completed | compress the BEAM mascot artwork into the two panel assets
     | files: scripts/optimize-beam-mascot.ts, package.json,
     |        public/img/beam-mascot.webp, public/img/beam-avatar.webp
     | depends on: T592
     | The source art is a 1.28 MB transparent PNG. sharp trims the transparent
     | margin and writes a 512px full mascot (95 kB) for the panel's empty state,
     | plus a 192px square crop of the head (20 kB) for the avatar beside each
     | answer. The avatar is a crop, not a downscale: at 32px the whole body
     | renders the face about eight pixels tall.
     | The crop box is stored as a fraction of the source, so re-exported art at
     | a different resolution still lands on the head.
     | Run: npm run img:beam-mascot -- --in "path/to/beam.png"
     | verified: yes (both files serve 200 from /img, visually checked at size)

T594 | completed | move Ask BEAM out of /tools into a site-wide header panel
     | files: components/beam/{beam-launcher,beam-panel,beam-chat,beam-mark}.tsx,
     |        components/beam/{beam-answer-card,beam-clarify,beam-unsupported,
     |        beam-learn-form}.tsx, components/site-header.tsx, lib/site.ts,
     |        app/tools/page.tsx, app/sitemap.ts, lib/guide/registry.ts,
     |        lib/guide/registry.test.ts
     | depends on: T593
     | BEAM is a question box, not a destination, so it now rides in the header
     | next to search on every breakpoint and opens a panel over whatever page
     | you are on. /tools/ask-beam is deleted, along with its entries in the
     | tools nav, the search palette, the footer, the tools hub, and the sitemap.
     | The panel slides up from the bottom on mobile and in from the right on
     | desktop, matching the Signal Guide panel: portal, focus trap, Esc,
     | scroll lock, focus restored to the header button, reduced motion honored.
     | It differs in one way on purpose: once opened it stays mounted and hides
     | with display:none plus inert, so closing it to read a player page does not
     | throw the conversation away.
     | The conversation itself was rebuilt as a chat rather than a page section:
     | the mascot greets you in the empty state, your question renders as your
     | own message, answers sit under BEAM's avatar, the composer is a pinned
     | rounded field with a circular send button, and the transcript follows the
     | newest turn. Announcement, focus and clarification behaviour from T592
     | are unchanged: one polite live region, the transcript itself never live.
     | The BEAM glyph is now the mascot's face drawn in one colour, built from
     | the logo's peak and arc so it sits next to the wordmark. Line art rather
     | than shrunken artwork, because the header button is 20 CSS px.
     | The ask-beam Signal Guide page key was removed with the route. Its nine
     | published entries are still in the database, now unreachable, so they need
     | either a new host or deleting.
     | verified: yes (tsc clean, 1691 tests across 120 files, next build clean,
     |           all-ASCII scan clean, /tools/ask-beam 404s, header button and
     |           /api/beam/ask answer against production data)

T595 | completed | add the missing close button to the Power Pulse mobile sheet
     | files: components/power-pulse/pulse-rankings-table.tsx
     | The team breakdown sheet on /leagues/[id]/power-pulse could only be closed
     | with Esc or a backdrop tap. It only ever opens on a phone, where there is
     | no Esc key and a backdrop tap is a guess. The close button is now the
     | first focusable element in the sheet, so it is also where focus lands,
     | and the sheet takes its accessible name from the team heading rather than
     | a hidden span that said the same words twice.
     | verified: yes (tsc clean, next build clean)

T596 | completed | teach BEAM the draft question
     | files: lib/beam/interpret/lexicon.ts, lib/beam/interpret/index.ts,
     |        lib/beam/resolve/player.ts, lib/beam/stats/registry.ts,
     |        lib/beam/capabilities/player-compare-verdict.ts,
     |        lib/beam/interpret/interpret.test.ts
     | "Who should I draft in a redraft league between Amon-Ra and James Cook"
     | was answerable all along: it is the Beacon Breakdown verdict this
     | capability already returns. Interpretation was what failed, in four
     | separate places, and each one produced the same dead end.
     | "draft" and "take" were in no vocabulary, so each became a one-word
     | player name and the question arrived with four subjects. They are now
     | question heads ("who should i draft", "who do i take", and six more) plus
     | a compare-better concept, which routes them to the verdict.
     | "and" was unclaimed, so "amon ra and james cook" merged into ONE name
     | span and resolved as a single player called "ra and james cook". It is
     | now filler, which breaks the token run and splits the two names. It stays
     | out of the comparator list on purpose: "or" and "vs" announce a
     | head-to-head, "and" often just joins two things.
     | "league" was unclaimed and became another one-word name.
     | The lens for an unstated league type was the constant "dynasty". It now
     | follows the reader's own resolved format (redraft reads win-now), and the
     | caveat says so, naming the format it followed.
     | "my draft" was flatly out of scope, which is right for "who should I
     | draft" and wrong for "who should I draft, Lamb or Nacua". Out-of-scope
     | phrases now split in two: the roster-dependent ones (start, trade,
     | waivers) still fire whatever else is in the question, and the
     | draft-shaped ones stand down once the reader has named two players.
     | Two resolver fixes fell out of testing it. A surname made of two words
     | failed the fuzzy tier's edit-distance gate outright ("brown" is three
     | edits from "st brown"), so the gate now measures against each word of the
     | surname. And a name whose spacing the reader guessed differently
     | ("amon ra st brown" against the stored "amonra st brown") now matches at
     | the EXACT tier by comparing both with the spaces removed, which also
     | fixes "ja marr chase" and "de von achane".
     | Found while verifying: a bare "throw" with no "for" after it was
     | unclaimed, so "how many interceptions did brock purdy throw in 2025"
     | resolved a player named "brock purdy throw". The bare verb forms are now
     | in the registry. "run" and "runs" are deliberately still absent: the lens
     | phrase "long run" is claimed later and a verb would eat half of it.
     | Also removed the singular "pick" as a phrasing for interceptions. Nobody
     | asks "how many pick did he throw", plenty of people ask "who should I
     | pick", and the stat vocabulary is claimed before question heads are.
     | verified: yes (tsc clean, 1698 tests across 120 files including 7 new,
     |           next build clean, npm run beam:smoke unchanged on all 30
     |           questions, and the reader's exact question answered against
     |           production data in both a redraft and a dynasty format)

T597 | completed | give BEAM's prose answers room to be prose
     | files: lib/beam/types.ts, lib/beam/answers/templates.ts,
     |        lib/beam/capabilities/glossary-term.ts,
     |        components/beam/beam-answer-card.tsx
     | A glossary definition was being carried as a fact, and a fact renders as a
     | label on the left and a value on the right, two pairs to a row. That put
     | three sentences of "what is FAAB" into a column a few words wide, which
     | read like a table cell that had overflowed.
     | BeamAnswer now has a `body` for text meant to be read as sentences.
     | glossary.term fills it and ships no facts at all; the card renders it as
     | full-width paragraphs, split on blank lines. buildSpeech speaks it right
     | after the headline, so the announcement is unchanged.
     | The card also stopped treating every fact the same way. A value of more
     | than seven words is laid out down the page (label above, sentence at full
     | width) instead of across it. That fixes the same squeeze in the
     | head-to-head verdict, whose three Beacon Breakdown takeaways are
     | sentences: they were sharing a two-column grid with "Lens: Dynasty".
     | Figures keep the compact grid, which is what it is good at. Word count
     | rather than string length is the test, because "6 foot 1, 220 pounds" is
     | a long string and still a figure.
     | verified: yes (tsc clean, 1698 tests across 120 files, next build clean,
     |           answers inspected against production for the glossary, the
     |           verdict, bio, value and stat-line shapes)

T598 | completed | answer the short glossary question
     | files: lib/beam/interpret/normalize.ts, lib/beam/interpret/lexicon.ts,
     |        lib/beam/capabilities/glossary-term.ts,
     |        lib/beam/interpret/interpret.test.ts
     | "whats ppr" failed on the apostrophe. The contraction map only knew
     | "what's", so "whats" carried no question head and glued itself to the
     | next word: BEAM searched the glossary for an entry called "whats ppr".
     | The four question contractions people type without an apostrophe
     | (whats, whos, hows, wheres) now expand. None of them is a name or a word
     | in any other vocabulary.
     | While testing it, two more: "whats tep" said we had never defined TEP,
     | because the entry is headed "TE Premium" and only the body says "often
     | shortened to TEP". The lookup now falls back to searching bodies when no
     | heading matches, with a whole-word check in TypeScript because ilike
     | '%tep%' also matches "step".
     | And "hows gibbs do in 2025" answered what he is WORTH. With no head
     | matched the question fell to whichever capability scores highest on
     | nothing, which is the value one. "how is" and "how are" now read as the
     | same head as "how did", so the present tense asks for the season line.
     | Known and left alone: a bare term with no question around it ("ppr" on
     | its own) still dead-ends. The glossary reading scores 0.50 against an
     | accept threshold of 0.55, and moving either number affects every
     | one-word question, so it wants its own change rather than a nudge here.
     | verified: yes (tsc clean, 1700 tests across 120 files including 3 new,
     |           next build clean, npm run beam:smoke unchanged on all 30
     |           questions, phrasings checked against production)

T599 | completed | answer questions about a stretch of weeks
     | files: lib/beam/interpret/weeks.ts (new), lib/beam/interpret/normalize.ts,
     |        lib/beam/interpret/entities.ts, lib/beam/interpret/lexicon.ts,
     |        lib/beam/interpret/score.ts, lib/beam/interpret/index.ts,
     |        lib/beam/capabilities/{shared,player-season-stat,
     |        player-compare-stat,index}.ts, lib/beam/stats/query.ts,
     |        lib/beam/answers/templates.ts, lib/beam/types.ts,
     |        scripts/beam-smoke.ts, lib/beam/interpret/interpret.test.ts
     | A week range is now a slot like a season or a stat, so the two existing
     | stat capabilities answer "between weeks 2 and 8" without either of them
     | learning a new question shape. The scanner reads "between weeks 2 and 8",
     | "from week 2 to week 8", "weeks 2 through 9", "weeks 2-8" and "in week 5".
     | Two ordering problems had to be solved for it to work at all. The season
     | parser reads a bare two-digit number in the 15 to 49 range as a year, so
     | the week pass runs BEFORE it: otherwise "between weeks 15 and 17" is a
     | question about the 2015 and 2017 seasons. And normalization deletes
     | hyphens, which turned "weeks 2-8" into "weeks 28"; a hyphen between two
     | digits now becomes a space, which no player name can be affected by.
     | The week filter goes into the query rather than being applied to the rows
     | afterwards, so a five-week question reads five rows on the same index.
     | Every sentence template now takes a worded period ("weeks 2 to 8 of 2025")
     | instead of a season number. That is the guard that matters: a five-week
     | total rendered as a season total is a wrong answer with a right number
     | in it, and now the type system will not let a template omit the range.
     | verified: yes (tsc clean, 1709 tests across 120 files, next build clean,
     |           beam:smoke unchanged on all 30 old questions, 5 new added)

T600 | completed | project a stretch of weeks across a full season
     | files: lib/beam/capabilities/player-weeks-projection.ts (new),
     |        lib/beam/capabilities/index.ts, lib/beam/types.ts,
     |        lib/beam/interpret/{lexicon,score,index}.ts
     | depends on: T599
     | "Project the season total from weeks 2 through 4 of last year for Michael
     | Wilson." Per game inside the window, times a full season (17 games since
     | 2021, 16 before). Both halves stated, plus the in-window total and the
     | games it came from.
     | Games, not weeks, is the denominator: a five-week window with two games
     | missed is three games of evidence, and dividing by five would punish a
     | player for being hurt. When the two differ the answer shows both averages
     | and says which one the projection used.
     | For fantasy points it also reports where that projected total would have
     | finished at the position that season, counted against
     | player_positional_finishes so BEAM's "would have been WR82 of 337" is
     | measured exactly like the finishes the profile page shows.
     | A rate cannot be projected (yards per carry across 17 games is arithmetic
     | with no meaning), so those report the rate and say why.
     | "project" is a REQUIRED slot, not a scoring bonus. A week-range total and
     | a week-range projection otherwise score identically and the projection
     | would win on registry order, answering "how many yards in weeks 2 to 8"
     | with a full-season extrapolation nobody asked for.
     | Found while testing: "how many targets did X see" was broken, and it is
     | one of the advertised examples. "see" was in no vocabulary, so it joined
     | the name span and the resolver was handed "ceedee lamb see". It is now a
     | verb on the targets stat.
     | verified: yes (tsc clean, 1709 tests, next build clean, all three question
     |           shapes answered against production data, including the
     |           missed-games path where per-game and per-week disagree)

T601 | completed | tolerate a typo in the word "weeks"
     | files: lib/beam/interpret/weeks.ts, lib/beam/interpret/interpret.test.ts
     | depends on: T599
     | "between weks 10 and 17" came back as "BEAM can handle two players at a
     | time", which is true and has nothing to do with what went wrong.
     | One dropped letter cascaded three ways: the misspelled keyword matched no
     | vocabulary so it became a name span, which made three subjects out of a
     | two-player question; the range was never found; and the orphaned "17" was
     | then read by the season parser as the 2017 season.
     | The week keyword now accepts anything within one edit of "week" or
     | "weeks". Guarded three ways so it cannot start eating real words: the
     | token must begin with "w", must be within that one edit, and the scanner
     | only claims it when a real week number follows.
     | BEAM was already forgiving about a player's name and unforgiving about
     | its own keywords. That asymmetry is invisible to the person typing, and
     | the error message it produced pointed at the wrong thing entirely.
     | Found by reading beam_queries rather than by asking: the question, its
     | outcome, and its failure reason were all already logged.
     | verified: yes (tsc clean, 1711 tests across 120 files including 2 new,
     |           next build clean, the reader's exact question answered against
     |           production data)

T602 | completed | stop unknown words from counting as players
     | files: lib/beam/interpret/index.ts, lib/beam/interpret/lexicon.ts,
     |        lib/beam/interpret/interpret.test.ts, scripts/beam-smoke.ts
     | depends on: T600
     | "Project Tucker Kraft's season totals for last year by using his weeks 1
     | through 5" came back as "BEAM can handle two players at a time".
     | The parse was almost perfect: the week range, the season and the
     | projection intent were all read correctly. But "totals" and "by using"
     | were in no vocabulary, and a name span is just a run of words nothing
     | else claimed, so the question arrived carrying three "players".
     | Two fixes, one narrow and one structural.
     | Narrow: totals, by, using, use, used, based on, off of and going by are
     | now filler. That is the fourth time an unclaimed ordinary word has cost a
     | question, after "and", "each", "league" and "draft".
     | Structural, and the one that ends the pattern: the too-many-players rule
     | no longer counts spans, it counts PEOPLE. When a question produces more
     | candidate names than the capability takes, every candidate is resolved
     | against the database and only the ones that are real players count.
     | Three real players still declines, for the original and correct reason.
     | A word we have never heard of now costs nothing.
     | The extra lookups only happen on questions that carry extra spans, which
     | is exactly the case that was failing, they run in parallel, and the
     | resolution memo means a second reading of the same question is free.
     | Verified against production that three genuine players still declines,
     | both for the verdict ("bijan or gibbs or hall") and for the stat
     | comparison ("purdy and lamb and gibbs").
     | verified: yes (tsc clean, 1712 tests across 120 files, next build clean,
     |           beam:smoke now 37 questions and all behave, the reader's exact
     |           question answered against production data)

T603 | completed | answer projection and beat-rate questions
     | files: lib/beam/projections/load.ts (new),
     |        lib/beam/interpret/season-span.ts (new),
     |        lib/beam/capabilities/player-{reliability,compare-reliability,
     |        projection,compare-projection}.ts (new),
     |        lib/beam/capabilities/{shared,index}.ts, lib/beam/types.ts,
     |        lib/beam/interpret/{entities,lexicon,score,index}.ts,
     |        lib/beam/examples.ts, lib/beam/interpret/interpret.test.ts,
     |        scripts/beam-smoke.ts
     | Four capabilities over two tables BEAM already had access to and had never
     | been taught to read: player_weekly_projections (what a player is projected
     | to score) and player_projection_accuracy (how often he has beaten one).
     | Single and two-player forms of each, because "who has the better beat
     | rate, A or B" is the question people actually ask.
     | A beat rate over several seasons is POOLED, sum(weeks beaten) over
     | sum(weeks played), never the mean of per-season rates. Averaging a
     | 14-week season against a 22-week one equally is how a cameo decides
     | whether a player is reliable.
     | New in the interpreter: a season SPAN ("over the last 3 years", "past two
     | seasons", "since 2023"), scanned before the season lexicon so it cannot
     | claim "last year" out of "last 3 years" and leave "3 years" behind as a
     | player name. Spans resolve against the newest GRADED season, not the
     | calendar: in August the current season has no results in it.
     | The seasons asked for and the seasons we hold are different sets, and the
     | answer names the second. We grade 2024 and 2025, so a three-year question
     | says so rather than quietly answering with two thirds of the evidence.
     | Registry order is now explicitly "most specific first", because scores
     | clamp at 1.00 and a tie breaks on position: the beat-rate comparison had
     | to sit above the head-to-head verdict, which fits the same words and
     | answers a different question. Starter chips no longer follow that order,
     | they follow their own list, so the panel still opens with the everyday
     | questions.
     | Four more unclaimed words claimed: against, often, higher, lower.
     | verified: yes (tsc clean, 1718 tests across 120 files including 6 new,
     |           next build clean, beam:smoke now 41 questions with only the 4
     |           intended dead ends and 2 intended clarifications, all four new
     |           shapes answered against production data)

T604 | completed | put a ceiling on the Ask BEAM endpoint as a whole
     | files: app/api/beam/ask/route.ts, lib/beam/default-settings.ts,
     |        lib/beam/settings.ts, lib/beam/context.ts,
     |        components/admin/beam-settings-manager.tsx
     | The per-actor limit (30 a minute) contains one abuser and does nothing
     | about five hundred addresses each behaving reasonably. There is now a
     | durable ceiling on the endpoint itself, 600 a minute by default, through
     | the same try_claim_rate_limit ledger.
     | Claimed AFTER the per-actor slot, never before. A request the caller's own
     | limit has already rejected must not spend shared budget, or one person
     | hammering the endpoint would push everyone else into a global rejection
     | while being rejected themselves.
     | Split into two pools, signed-in and guest, each with the configured
     | budget. A single pool is a lever: at 30 per actor against 600 shared,
     | twenty addresses can deny the endpoint to everybody. Splitting does not
     | prevent that, it confines it to the cheap tier and keeps the two visible
     | separately in the ledger.
     | Fixed while implementing, both found by the review pass:
     | Raising the ceiling from the admin was a no-op. The route claimed on the
     | code default and re-claimed on a second bucket only when the configured
     | value was TIGHTER, so an operator raising it for real growth saw it save,
     | saw it persist, and got no change. Settings are now read BEFORE the
     | limiters and both claim on the configured numbers, which also deletes the
     | two conditional re-claims. No extra read: the settings are handed to
     | buildBeamContext, which used to read the same row itself.
     | The zod schema now enforces the invariant its own comment promised: the
     | ceiling must allow at least as many questions per second as one visitor,
     | compared as rates because the two windows are configured independently.
     | Retry-After now carries the real window rather than a guess, and the
     | rejection paths carry no-store.
     | Reviewed and deliberately not done: sharding the ledger row (measured at
     | 52 microseconds a claim, saturating around 1500 to 2000 req/s, which is
     | 150x the ceiling, and sharding would make the admin number stop meaning
     | what its label says); dropping the updated_at index so the row can take
     | HOT updates (a property of migration 0137, worth doing when traffic
     | justifies it); the content-length header being client-supplied and the
     | duplicate auth.getUser per request (both pre-existing).
     | verified: yes (tsc clean, 1718 tests, next build clean, limiter counting
     |           and concurrency verified against prod on a throwaway bucket:
     |           10 concurrent claims against a max of 5 allowed exactly 5;
     |           stored settings row backfills the new fields; the invariant
     |           rejects a ceiling below one visitor's rate and accepts a raise)

T605 | completed | give the whole site the League Pulse dashboard chrome
     | files: lib/nav-tree.ts, lib/breadcrumbs.ts, lib/nav-viewer.ts,
     |        components/app-shell/sidebar-state.tsx,
     |        components/app-shell/nav-levels.tsx,
     |        components/app-shell/app-rail.tsx,
     |        components/app-shell/app-mobile-nav.tsx,
     |        components/app-shell/rail-toggle.tsx,
     |        components/app-shell/rail-sections.tsx,
     |        components/app-shell/breadcrumb-bar.tsx,
     |        components/app-shell/app-shell.tsx,
     |        components/app-shell/page-masthead.tsx,
     |        components/app-shell/page-body.tsx,
     |        components/app-shell/index.ts,
     |        components/league-shell/league-rail-sections.tsx,
     |        components/league-shell/league-shell.tsx,
     |        components/league-shell/index.ts,
     |        components/header-shell.tsx, components/site-header.tsx,
     |        app/layout.tsx, app/globals.css
     | depends on: T604
     | The dashboard League Pulse got in b87ca43 is now the site's chrome, not
     | one feature's. Every page renders inside a rail plus a breadcrumb bar.
     | The rail is the site nav: sections down the left, collapsed to icons by
     | default, widened by a toggle in the header that remembers the choice.
     | A section with sub-pages opens a second level in place, level one sliding
     | out left while level two comes in from the right. The parked level is
     | inert, so a reader can never tab to a link that is off screen.
     | Rail width is driven by data-sidebar on <html>, set by a blocking script
     | before first paint. React state mirrors it only for aria-expanded. A
     | React-driven width would paint collapsed and snap open on every load for
     | anyone who had expanded it.
     | Header and rail are merged: the header's left cell is the width of the
     | rail, so collapsing the rail leaves the mark alone and expanding it
     | brings the wordmark back. The rest of the header (search, BEAM, format
     | and source, account) is always there and always sticky. The floating
     | pill and the transparent-at-top state are both gone; a pill cannot sit
     | on top of a rail. Height stays 72px, which everything sticky depends on.
     | The horizontal primary nav is deleted along with nav-dropdown.tsx,
     | header-nav-link.tsx, and mobile-menu.tsx. The mobile drawer replaces the
     | last of those and carries the same tree, the same two levels, and the
     | same format and source controls.
     | Breadcrumbs are derived from the pathname (lib/breadcrumbs.ts) rather
     | than passed from each page, so a new route gets one the moment it
     | exists. The bar emits BreadcrumbList JSON-LD except on the routes that
     | already publish their own.
     | League Pulse no longer has a rail of its own. It registers its five
     | sections into the site rail through rail-sections.tsx, opened on
     | arrival, so every site section is one Back press away. Deletes
     | league-side-nav.tsx and league-mobile-nav.tsx.
     | Caught while checking the result in a browser: the palette names a colour
     | `base`, and Tailwind turns every colour into a `text-*` utility, so there
     | were two rules called `.text-base` and the colour one won inside a
     | breakpoint. Anything written `text-sm sm:text-base` therefore went from
     | readable grey to #07070D against a #07070D page at the sm breakpoint:
     | invisible text, above one screen width only. `textColor` is now redefined
     | outside `extend` to drop that one entry, so `text-base` means a font size
     | and nothing else. Every other colour still has its `text-*` utility, and
     | `bg-base` and `border-base` are untouched.
     | Also caught in the browser: the blocking script writes data-sidebar on
     | <html>, which React reported as a hydration mismatch on every load. The
     | server now renders the collapsed value and <html> carries
     | suppressHydrationWarning, which is what that attribute is for.
     | Four review passes ran (implementation, security, performance,
     | accessibility). Everything confirmed is fixed. The ones that mattered:
     | The rail's Escape listener was on the document, so closing the search
     | palette on any route with a level open also collapsed the rail and
     | dragged focus onto a section button. It is bound to the nav now.
     | The site had no navigation landmark at all. The rail was an <aside>
     | (complementary) and the drawer had no <nav> inside it, so the primary
     | navigation was not findable by landmark on any page. NavLevels is a
     | <nav> now, and the rail box around it is a plain div.
     | lib/nav-tree.ts names every admin route, and it was imported by two
     | client components, so `curl` on the layout chunk handed an anonymous
     | visitor the full admin map. The tree is server-only now, built and cut
     | down on the server, and nodes name their icon instead of carrying it so
     | they can cross the boundary. Verified against a clean build: the layout
     | chunk has no /admin path in it.
     | The root layout awaited the session before returning, which blocked
     | React from descending into the page and put one auth round trip in front
     | of every page's own fetching. The rail is an async child behind Suspense
     | now and the layout is synchronous again.
     | The header and the layout each read the session and user_preferences
     | separately: two round trips per page to learn one thing. Both go through
     | getNavViewer, which is React-cached, and buildNavTree is cached on the
     | same object so the tree is serialised once rather than twice.
     | ink-subtle measured about 3.8:1 and carried real 10px and 11px text
     | (stat-tile labels, drawer hints, the source and format labels). Raised
     | to #8A8A9C, about 5.4:1.
     | The breadcrumb bar hand-rolled its JSON-LD escaping; it goes through
     | serializeJsonLd now, per FFB-SEC-006.
     | The bar was suppressed wholesale on league routes, taking the
     | BreadcrumbList with it, and nothing under /leagues publishes one. The
     | visible trail and the structured data are separate decisions now.
     | Two buttons used `text-base` for its colour meaning and lost their dark
     | text when the collision was fixed; both now name the hex.
     | The Signal Guide trigger and the On The Clock docked bar are both fixed
     | to the viewport at bottom-left, which from lg up is where the rail is.
     | Both clear it, and both track its width.
     | The 1.3 MB logo PNG was painted at 34px in the header and 20px in the
     | breadcrumb bar on every page. A 96px mark at 4.9 KB replaces it in all
     | five in-page renders; the full-size file stays for OG and email.
     | AdminNav and MyBeaconNav only asked the rail to open a section it
     | already opens from the pathname, so both are deleted.
     | verified: yes (tsc clean, 1747 tests across 122 files, next build clean
     |           on a fresh .next, and the rail, the submenu slide, the league
     |           sections, the breadcrumb labels, and the admin tree all
     |           checked in a browser)

T606 | completed | move the draft room's view switcher into the site rail
     | files: app/tools/on-the-clock/draft-room-rail.tsx,
     |        app/tools/on-the-clock/on-the-clock-client.tsx,
     |        app/tools/on-the-clock/sidebar-sheet.tsx,
     |        app/tools/on-the-clock/command-header.tsx,
     |        app/tools/on-the-clock/draft-radar.tsx,
     |        app/tools/on-the-clock/dashboard-panels.tsx,
     |        app/tools/on-the-clock/rosters-rankings.tsx,
     |        app/tools/on-the-clock/draft-grades.tsx,
     |        app/tools/on-the-clock/states.tsx,
     |        lib/nav-types.ts, lib/nav-tree.ts,
     |        components/app-shell/nav-levels.tsx,
     |        components/app-shell/nav-icons.ts,
     |        components/app-shell/rail-sections.tsx,
     |        components/app-shell/app-rail.tsx,
     |        components/app-shell/app-mobile-nav.tsx
     | depends on: T605
     | On The Clock kept its own horizontal strip when the rest of the site
     | moved into the rail. Its eight views are now rail rows, under a section
     | named for the draft you are in, opened on arrival, the same shape League
     | Pulse uses.
     | The one difference is what a row does. League Pulse sections are routes,
     | so those rows are links. Draft views are eight states of one live page:
     | the room holds a websocket, a synced board, a loaded player pool, and
     | whatever is half-built in the trade builder. Navigating to change view
     | would throw all of that away, so a node can now carry `onSelect` and no
     | `href` and switch in place instead. Only a client registrar sets that, so
     | no function is ever asked to cross the server boundary.
     | A section with no `href` gets no index row, because a draft room has no
     | page of its own to link back to.
     | The strip sat directly above the panel it switched, which is what let it
     | be a real tablist: the tab-to-panel relationship carried the
     | announcement, and the panel appeared where the reader was already
     | looking. The rail is nowhere near the content, so pressing a row now
     | focuses the view's region and scrolls it under the header. Without that a
     | reader gets no feedback at all beyond aria-current, and a drafter is left
     | looking at the page masthead.
     | Panels become `role="region"` with their own `aria-label` rather than
     | `role="tabpanel"` labelled by the pressed control: the rail is
     | display:none below lg, and an aria-labelledby pointing into it would
     | resolve to nothing on a phone.
     | Registration happens inside the draft room return, after the connect and
     | league-picker steps have returned, so the rail only grows the section
     | once a draft is actually open and drops it again on the way out.
     | Three review passes ran (implementation, accessibility, and one covering
     | security and performance). Everything confirmed is fixed:
     | The level-two row count announced one too many for a section with no
     | index row, which the same change had just made possible.
     | The pathname trail was being replaced by the contributed one, so while a
     | draft was open nothing in the site tree carried aria-current: you were on
     | the Grades view AND on /tools/on-the-clock, and only the first was said.
     | Both trails are passed down now.
     | The regions carried scroll-mt-36 while SidebarSheet sets a root
     | scrollPaddingTop of 8.5rem for its whole lifetime, which is every width
     | below xl. Scroll-margin and scroll-padding add, so the target landed
     | about 144px too low. The old tabs carried the same margin and never
     | scrolled, so it had never fired.
     | Nothing on the page named the view any more. The rail is collapsed to
     | icons by default and hidden below lg, so the name is now a chip in the
     | command header, and each region is labelled by a visually hidden heading
     | rather than an aria-label, which puts it back in heading navigation.
     | The focus-and-scroll ran in a frame scheduled beside setView, which
     | assumed the commit landed first. A hidden element takes no focus and
     | cannot be scrolled to, and both calls fail silently. It is an effect
     | keyed on the view now.
     | The registration signature hashed only ids and hrefs, and every draft node
     | has no href, so it was a constant: renaming a section in place would
     | never have re-registered. Labels are in it now.
     | NavNode became a union, so a row carries an href or an onSelect and never
     | neither, and the server tree is typed as SiteNavNode, which has no
     | onSelect at all and so cannot grow a function that Next would refuse to
     | serialise.
     | register and clear were one effect, so every re-registration blanked the
     | rail and restored it, correct only because React batches. Split.
     | The drawer restored focus on every dismissal path except a row press.
     | Deliberately not done, for the owner to decide: on a phone, switching view
     | is now three taps through the drawer rather than one. Nothing is hidden,
     | so the mobile-first rule holds, but a live draft is the one surface where
     | that tempo cost is real. The fix, if wanted, is a room-level bottom sheet
     | below lg reusing the SidebarSheet pattern already in that spot.
     | verified: yes (tsc clean, 1747 tests across 122 files, next build clean on
     |           a fresh .next, and the section appearing on entry, disappearing
     |           on exit, switching views, and marking the active row all checked
     |           in a browser against a live Sleeper draft)

T607 | completed | drop the hero once a draft room is open
     | files: app/tools/on-the-clock/page.tsx,
     |        app/tools/on-the-clock/on-the-clock-client.tsx,
     |        app/tools/on-the-clock/command-header.tsx
     | depends on: T606
     | Inside a room the first thing under the breadcrumbs is the room, and the
     | league name is the page title. Marketing copy above a live draft is in
     | the way, and the room already names itself.
     | The page cannot make that call: whether a draft is open is client state.
     | So the hero is rendered on the server and handed to the client as a prop,
     | and every step before the room (connect, league picker, and the loading
     | and error gates between them) renders it through one `beforeRoom`
     | wrapper. The room does not.
     | That moves the page h1. It was the hero's; in a room it is the league
     | name in the command header, which now carries `.beacon-page-title` at the
     | shared masthead size. Exactly one h1 either way.
     | Deletes the sr-only "Connect a draft" h2 that wrapped the whole tool. It
     | sat above the room's own h1 in document order, so a heading list read h2
     | then h1, and it described the connect step while a draft was open.
     | The command header's gutters now match the room body (px-4 sm:px-6)
     | instead of capping at max-w-7xl. The room is the widest column on the
     | site and the page title has to line up with the content under it.
     | verified: yes (tsc clean, 1747 tests across 122 files, next build clean;
     |           no browser check, at the owner's request)

T608 | completed | drop the Your team row from the draft board
     | files: app/tools/on-the-clock/on-the-clock-client.tsx
     | depends on: T607
     | The Board view opened on room status, best remaining, then the connected
     | user's roster, then the board itself. The roster row is gone; the board
     | now follows the first row directly.
     | Board only. The same panel in the side rail (and in the Quick info sheet
     | below xl) is untouched, and so is the Rosters view, which is where a
     | roster laid out by position belongs.
     | The board view was also the only reason `teamRollups` was built outside
     | the four views that read them. Nothing on the board reads a rollup now,
     | so that work was thrown away on every realtime pick. It is off the board
     | path, which makes the busiest view in the room cheaper per pick.
     | Removes `myBoardRollup` and the `TeamPositionGrid` import, both of which
     | had no other consumer.
     | verified: yes (tsc clean, 1747 tests across 122 files, next build clean;
     |           no browser check, at the owner's request)

T609 | completed | give the draft room its own view switcher on a phone
     | files: app/tools/on-the-clock/draft-view-sheet.tsx,
     |        app/tools/on-the-clock/sidebar-sheet.tsx,
     |        app/tools/on-the-clock/on-the-clock-client.tsx
     | depends on: T606
     | The eight views live in the site rail, and the rail only exists from lg
     | up. Below that they were reachable only through the site drawer: open a
     | modal from the header, find the section, press a row. Fine for browsing
     | the site, wrong with a clock running.
     | Below lg the room now carries one control naming the view you are on,
     | opening a sheet of all eight. The rail rows stay canonical; this is the
     | same eight actions reached a shorter way, so nothing is exclusive to the
     | small layout.
     | It rides in the Quick info bar rather than getting its own. Two bars that
     | both dock would park at the same offset and cover each other, and
     | stacking them would push the room down by two bar heights. SidebarSheet
     | takes a `leading` slot and its own button drops from w-full to flex-1, so
     | between lg and xl, where the switcher hides itself, the bar looks exactly
     | as it did.
     | verified: yes (tsc clean, 1747 tests across 122 files, next build clean;
     |           no browser check, at the owner's request)

T610 | completed | widen the Signal Check builder
     | files: app/tools/signal-check/page.tsx
     | The content below the hero was capped at max-w-5xl, which left the trade
     | builder in a narrow column on a wide screen while the masthead above it
     | ran the full width. It is 90rem now.
     | Still capped rather than edge to edge: the builder is two rosters side by
     | side with a verdict between them, and past about 90rem the two sides
     | drift far enough apart that comparing them means moving your head.
     | verified: yes (tsc clean, 1747 tests, next build clean; no browser check,
     |           at the owner's request)

T611 | completed | let Beacon Breakdown and FAAB use the full width
     | files: app/tools/beacon-breakdown/page.tsx, app/tools/faab/page.tsx,
     |        app/tools/faab/faab-form.tsx
     | depends on: T610
     | Both tools ran their content in a narrow column under a full-width hero,
     | which read as two different pages stacked.
     | Beacon Breakdown: the hero is gone once both players are picked, so the
     | comparison follows the breadcrumb directly, and the column goes from
     | max-w-5xl to 90rem. The selector on its own keeps the narrower measure it
     | was designed for. `hasBoth` is a searchParams read, so the server already
     | knew; no state had to move.
     | The results use the width rather than just having it: the edge meter and
     | the contribution chart sit side by side from xl, and so do the takeaways
     | and the verdict. They answer the same question from two angles and are
     | easier to read as a pair. Below xl they stack exactly as before.
     | FAAB: same idea, but whether a bid is on screen is client state, so the
     | hero is handed to FaabForm the way the draft room's is handed to its
     | client, and the form decides. The column widens to 88rem once a player is
     | picked and stays at max-w-3xl before that.
     | Widening alone did nothing for it, because the content was one stacked
     | column either way and the extra space just went to the margins. The form
     | now splits: league setup on the left, the bid on the right, from lg up
     | and only once there is a bid to show. The right column is sticky, so the
     | recommendation stays on screen while the setup below it is adjusted,
     | which is the loop the tool exists for. The left column carries z-10 so
     | the player combobox's listbox still paints over the sticky column beside
     | it; a sticky element makes its own stacking context and would otherwise
     | win.
     | Capped the two controls that had no reason to grow with it: the budget
     | box (max-w-xs) and the need options (max-w-md). A 950px-wide number input
     | is what widening a form gets you if nobody looks.
     | Both pages keep exactly one h1. The hero owned it; where the hero is gone
     | it is a visually hidden heading, because the matchup header and the
     | selected-player card already name the subject directly below and a second
     | title would just repeat them.
     | verified: yes (tsc clean, 1747 tests across 122 files, next build clean;
     |           no browser check, at the owner's request)

T612 | completed | FAAB full width for real, and open the rail by default
     | files: app/tools/faab/faab-form.tsx,
     |        components/app-shell/sidebar-state.tsx, app/layout.tsx,
     |        app/globals.css
     | depends on: T611
     | T611 widened FAAB only once a player was picked, so the page people
     | actually land on still sat in a 48rem column under a full-width hero,
     | and the layout jumped the moment they picked someone. One width now,
     | 88rem, always, matching the other tools.
     | The two-column split is unconditional too. The right column already had
     | something to show before a player is picked: ManualResult renders an
     | empty state explaining what will appear there, which is a better use of
     | the space than centring the form and leaving half the page blank.
     | The container's top margin is the gap under the hero, so it goes when the
     | hero does and the tool sits directly under the breadcrumb bar.
     | Rail default flipped from collapsed to expanded. Only an explicit "0" in
     | storage collapses it now, so someone who has never touched the toggle
     | reads section names instead of a column of repeated icons. The server
     | renders `data-sidebar="expanded"` to match, so the blocking script only
     | ever has to flip it the other way.
     | verified: yes (tsc clean, 1747 tests across 122 files, next build clean;
     |           no browser check, at the owner's request)

T613 | completed | quieter rail highlight, purple left edge
     | files: components/app-shell/nav-levels.tsx
     | depends on: T612
     | The current row in the rail was a cyan ring, a cyan fill, and cyan text,
     | which read louder than the page it was pointing at. It is a 2px purple
     | left edge and a 7% white background now, and hover lightens to 5% instead
     | of darkening toward the page color.
     | The edge is a border on the row rather than a bar laid over it, so it
     | follows the corner radius. It sits on the shared row base at 2px in
     | transparent, so no row shifts sideways as the current one moves. That
     | retired ActiveBar, which the border replaces.
     | The drawer's icon chip and label follow the same switch off cyan, so a
     | row is not half one accent and half the other. aria-current still carries
     | the state, so the color is decoration rather than the only signal, and the
     | focus ring stays cyan and distinct from selection.
     | verified: yes (tsc clean, 1747 tests across 122 files, next build clean;
     |           no browser check, at the owner's request)

T614 | completed | player profile sections move into the navigation rail
     | files: components/player-profile/nav-items.ts,
     |        components/player-profile/player-rail-sections.tsx,
     |        components/player-profile/player-tabs.tsx,
     |        components/app-shell/nav-icons.ts, app/players/[slug]/page.tsx
     | depends on: T613
     | The profile carried a full-width bar of four tabs under its masthead,
     | which was the last surface still navigating itself instead of using the
     | rail. The four sections now register into the rail the way a league's five
     | do, as a section named for the player, opened to its second level.
     | The section has no href: Overview is the profile's own page and is already
     | the first child, so an index row above it would be the same link twice.
     | Which row is current cannot be read from the pathname here, because all
     | four are the same path and differ only by ?tab=, so the profile states it
     | on the registration.
     | The list lives in nav-items.ts, mirroring components/league-shell, and
     | both the rail and the small-screen strip read it, so a section cannot
     | appear in one and go missing from the other. VALID_TABS is derived from
     | the same list rather than restating it.
     | The rail only exists from lg up, so below that the profile keeps a strip
     | of the same four links where the old bar was, matching what the draft room
     | does with its views. Every row keeps its one-line hint in the accessible
     | name, so it announces the same thing in the strip, the rail, and the
     | drawer, and the chips hold a 44px tap target at every width.
     | nav-icons gained barChart, so the Statistics row keeps the icon it had.
     | verified: yes (tsc clean, 1747 tests across 122 files, next build clean;
     |           no browser check, at the owner's request)

T615 | completed | player profile takes the dashboard width, rails move right
     | files: components/player-profile/overview-tab.tsx,
     |        components/player-profile/stats-tab.tsx,
     |        components/player-profile/trades-tab.tsx,
     |        components/player-profile/beacon-brief-tab.tsx,
     |        components/player-profile/tab-loading.tsx,
     |        app/players/[slug]/page.tsx
     | depends on: T614
     | Every part of the profile ran in its own max-w-7xl column, so a profile
     | sat centered in the shell while every tool beside it went edge to edge.
     | All five surfaces use PageBody now, which is the same gutters League
     | Pulse and the tools use, and the masthead lost its cap too.
     | Overview and Statistics both use the League Pulse split,
     | xl:grid-cols-[minmax(0,1fr)_340px]. Overview's panels were already on the
     | right; Statistics' positional finishes led from the left and now follow
     | the tables, which is also the order a phone should read them in.
     | Both rails follow you down the page from xl, the way the draft room's and
     | League Pulse's do. Neither fits a viewport (the overview stacks four
     | panels; a long career puts one card per season in the other), so they cap
     | at the viewport height and scroll inside themselves rather than sticking
     | with their lower panels parked off screen. Each takes focus so that scroll
     | is reachable from the keyboard.
     | No panel was dropped or gated behind a breakpoint. Under xl each rail
     | stacks under the content it belongs to, exactly as before.
     | verified: yes (tsc clean, 1747 tests across 122 files, next build clean;
     |           no browser check, at the owner's request)

T616 | completed | a contributed rail section can replace a site one
     | files: components/app-shell/rail-sections.tsx,
     |        components/app-shell/app-rail.tsx,
     |        components/app-shell/app-mobile-nav.tsx
     | depends on: T615
     | Contributed sections were prepended to the site tree, which is right when
     | the id is new (a league, a draft room, a player). The Beacon Brief needs
     | to contribute the section the site tree ALREADY carries, with its
     | categories added underneath, and prepending that would have listed
     | "The Beacon Brief" twice and handed React two children with one key.
     | mergeRailSections drops a site section whose id a contributed one already
     | claims. Both the rail and the drawer read it, so they cannot disagree.
     | verified: yes (tsc clean, 1747 tests across 122 files, next build clean;
     |           no browser check, at the owner's request)

T617 | completed | Beacon Brief categories move into the navigation rail
     | files: components/beacon-brief/brief-rail-sections.tsx,
     |        components/beacon-brief/brief-sidebar.tsx,
     |        components/beacon-brief/brief-feed.tsx,
     |        app/brief/[slug]/page.tsx
     | depends on: T616
     | Categories were one of four blocks in the Brief's own filter rail, which
     | undersold them: they are the Brief's structure, not one filter among
     | several. They are the Brief's second level in the site rail now, so the
     | Brief opens onto its nine categories while you are inside it and every
     | site section stays one Back press away.
     | Categories are DB rows, so they arrive from the page rather than from
     | lib/nav-tree.ts, which every route loads and which should not have to
     | query for a list only the Brief uses.
     | Nothing was lost in the move. Each row carries its category's article
     | count and the first line of its description in the hint, which is painted
     | under the label in the drawer and read out in the rail, so the count the
     | filter rail showed in a pill is still there.
     | Rows are icon-coded per category rather than nine identical glyphs.
     | aria-current is exact: the index row is the current page only on /brief
     | itself, a category row only on that category, and nothing is marked on a
     | tag, player, team, or article view, which a pathname match alone could
     | not express.
     | verified: yes (tsc clean, 1747 tests across 122 files, next build clean;
     |           no browser check, at the owner's request)

T618 | completed | Beacon Brief filter rail moves right and follows you
     | files: components/beacon-brief/brief-shell.tsx
     | depends on: T617
     | The rail sat on the left in a 16rem column, which put a stack of filters
     | between the reader and the thing they came for, and left the Brief the
     | only surface still leading with a sidebar.
     | It is on the right now, from xl, in the same 340px track League Pulse and
     | the player profile use, and it follows you down the page: capped at the
     | viewport, scrolling inside itself, focusable so that scroll works from
     | the keyboard.
     | Below xl it still collapses behind the "Browse and filter" button into
     | the full-screen drawer, and the button now DOCKS: once you scroll past
     | it, it re-attaches under the site header, and it lets go again when you
     | scroll back. Same IntersectionObserver the draft room's Quick info bar
     | uses, including the inset that keeps it lined up with the flow and off
     | the navigation rail between lg and xl.
     | Two things the draft room learned the hard way are handled here too. The
     | slot keeps the bar's height whether the bar is in it or docked, so the
     | page never jumps. And scroll-padding-top is set for exactly as long as
     | the bar is docked, so a link tabbed into never lands underneath it
     | (WCAG 2.2 AA, 2.4.11). The observer also requires a laid-out box, because
     | from xl the slot is display:none and a hidden element reports a zero box
     | that otherwise reads as "scrolled past".
     | verified: yes (tsc clean, 1747 tests across 122 files, next build clean;
     |           no browser check, at the owner's request)

T619 | completed | Beacon Brief articles take the dashboard width
     | files: app/brief/[slug]/page.tsx
     | depends on: T618
     | An article ran in a centered max-w-4xl column with nothing beside it,
     | which read as a different site from the listing page it was reached from.
     | It renders in the same shell now, filter rail included, so the Brief is
     | one surface from the index through to a story.
     | The prose does not take the new width. A column that wide is unreadable
     | at body size, so the article, the related grid, and the back link keep the
     | measure they had and sit centred in the space the rail leaves.
     | The rail's data comes from the same loadSidebar the listing pages call.
     | It is a published-content read like the rest of the page, so the route is
     | still prerendered and still revalidates on its 5-minute timer.
     | verified: yes (tsc clean, 1747 tests across 122 files, next build clean;
     |           no browser check, at the owner's request)

T620 | completed | published guides take the shell width
     | files: components/guides/guide-shell.tsx,
     |        components/guides/guide-toc.tsx,
     |        components/guides/guide-section-header.tsx,
     |        app/guides/fantasy-football-draft-guide/page.tsx,
     |        app/guides/fantasy-football-terms/page.tsx
     | depends on: T619
     | Both guides ran in a centred reading column, masthead included, which
     | left a guide narrower than its own index page and narrower than every
     | tool beside it. The masthead spans the shell now, like every other page's.
     | The prose does not take that width, because a line of body copy across a
     | dashboard is unreadable. The body sits in a two-column shell: the text
     | keeps a 56rem measure and a rail beside it holds the contents list, on the
     | right from xl, following you down the page, capped at the viewport and
     | scrolling inside itself. Below xl the rail leads the content, which is
     | where a contents list belongs on a phone and where the glossary's jump
     | list already sat. One copy of it either way, so no anchor id is ever in
     | the document twice. Past 56rem the pair centres as a unit rather than
     | leaving the rail stranded at the far edge of a very wide screen.
     | The draft guide's format switcher moves into that rail. It is what the
     | whole board answers to, and in the flow it scrolled away on the first
     | screen.
     | The headers were the other half of it, and they were three sizes of wrong.
     | The draft guide set its section h2s at text-4xl, nearly the size of the
     | page title and two steps above their own h3s, so every section opened like
     | a second page. Its closing section then used an h2 at text-lg, the same
     | size as those h3s and with no rule above it, so the last section read as a
     | subsection of the one before it. The glossary meanwhile had no eyebrows,
     | no rules above its headings, and a beacon hairline UNDER each section
     | intro, which put the divider inside the group it was meant to separate.
     | One GuideSectionHeader now opens every section of both guides (rule,
     | optional eyebrow, h2 at text-2xl / sm:text-3xl) and one GuideSubheading
     | sets every h3, so the step from section to subsection is the same
     | everywhere and neither competes with the masthead.
     | Heading levels, ids, and scroll-mt are unchanged, so every deep link into
     | a glossary term still lands where it did and the DefinedTerm structured
     | data still matches the page.
     | verified: yes (tsc clean, 1747 tests across 122 files, next build clean;
     |           no browser check, at the owner's request)

T621 | completed | About and the author page take the shell width
     | files: app/about/page.tsx, app/author/michael/page.tsx
     | depends on: T620
     | Both pages ran every section in a centred 80rem column, masthead
     | included, so on a wide screen they sat in the middle of a shell the tools
     | beside them fill. The mastheads span the shell now, and each section uses
     | the shell's own gutters, so the banded backgrounds and their content line
     | up with the rest of the site. The two pages also disagreed on vertical
     | rhythm (py-16 / sm:py-20 against py-14 / sm:py-16); they are both on the
     | tighter one now.
     | Width is spent where there is something to spend it on. The card grids
     | (four principles, three features, four facts, three tools) take it and
     | get roomier. The blocks that are one panel or one column of prose do not:
     | the founder panel, the Connect panel, the two long-form story columns,
     | the two gap cards, and the placeholder pair all keep a measure, because
     | stretching three sentences across a dashboard is not using the width, it
     | is just a longer line.
     | Left alone on purpose: DiscordCtaSection still caps at 80rem, and it
     | closes both of these pages. It is shared with the guides, the Brief, and
     | the tools, so changing it is a site-wide visual change rather than a
     | change to these two pages.
     | verified: yes (tsc clean, 1747 tests across 122 files, next build clean;
     |           no browser check, at the owner's request)

T622 | completed | About and the author page rebuilt as dashboard surfaces
     | files: app/about/page.tsx, app/author/michael/page.tsx,
     |        components/app-shell/page-columns.tsx,
     |        components/contact-panel.tsx, components/link-tile.tsx
     | depends on: T621
     | T621 widened these two pages. That was the wrong fix: they were written
     | as landing pages for the old chrome, so widening them stretched a landing
     | page instead of making a dashboard. Both are rebuilt on the shape the
     | rest of the site uses, a masthead over a main column of panels with a
     | rail on the right that follows you down the page.
     | PageColumns is that body, shared by both and matching the League Pulse,
     | player-profile, and Brief rails: 340px, sticky from xl, capped at the
     | viewport, scrolling inside itself, focusable so that scroll reaches the
     | keyboard. The rail is second in DOM order because everything in it is
     | supplementary to the page beside it.
     | The rail leads with a contact form. It posts to /api/guide/submit, the
     | Signal Guide's existing intake, with this page's guide_pages key ("about"
     | and "author" both already exist). That route already carries a same-origin
     | check, a honeypot, server-side validation, a per-IP rate limit, and the
     | email to the team plus a confirmation to the sender. A second endpoint
     | would have been a second copy of all of it to keep hardened, and messages
     | would have landed in two inboxes instead of one queue.
     | ABOUT: the masthead's counts are read from the database rather than typed
     | in, so the tool count, the active format count, and the source count
     | cannot go stale, and each falls back to omitting the stat rather than
     | showing a guess. New content: every tool, guide, game, and account feature
     | as a linked tile, which is also where this page earns its internal links;
     | an accessibility section stating the six rules that actually decide
     | whether something is finished; and a data section naming the live sources,
     | the nightly rebuild, and the rule that a league grades in its own scoring
     | settings rather than the global toggle.
     | AUTHOR: the story and the reasons stay, moved into panels. New content:
     | what he has built, as six links into the work, so the byline page carries
     | real evidence for the Person schema it publishes rather than a portrait
     | and three paragraphs.
     | verified: yes (tsc clean, 1747 tests across 122 files, next build clean;
     |           no browser check, at the owner's request)

T623 | completed | My Beacon gets the rail, and the Signal card moves into it
     | files: app/my-beacon/layout.tsx, app/my-beacon/beacon-rail.tsx,
     |        app/my-beacon/page.tsx, components/signal/signal-status-card.tsx,
     |        app/my-beacon/account/page.tsx, app/my-beacon/profile/page.tsx,
     |        app/my-beacon/rankings/page.tsx,
     |        app/my-beacon/rankings/profile-boards-manager.tsx,
     |        app/my-beacon/signal/page.tsx,
     |        app/my-beacon/signal/identity/page.tsx,
     |        app/my-beacon/signal/showcase/page.tsx,
     |        app/my-beacon/sleeper-leagues/page.tsx,
     |        app/my-beacon/sleeper-leagues/sleeper-connection.tsx
     | depends on: T622
     | The Signal card rode inside the masthead, where it squeezed the page title
     | on a laptop and pushed the actual page down on anything narrower. It now
     | heads a rail that follows you down every My Beacon page, the same
     | PageColumns the About and author pages use.
     | The rail also took the dashboard's opening row of four tiles. Those facts
     | (format, source, leagues on profile, member since) were true of the
     | ACCOUNT rather than of the dashboard, so showing them on one page out of
     | six was the wrong place for them. They are joined by two more the rail had
     | room for: how many custom boards exist, and whether a Sleeper handle is
     | connected, with the link changing to match. An admin sees the panel that
     | used to be a callout at the top of the dashboard.
     | The layout loads all of it in one pass. The registry reads and the
     | preference resolvers are React.cache'd, so a page that needs the same
     | values shares the layout's Promises rather than running them again.
     | The Signal card's frame changed from an aside to a section. It sits inside
     | the rail now, which is itself the complementary landmark, and a
     | complementary nested in a complementary reads as two of the same thing in
     | a landmark list.
     | The dashboard is panels now rather than banded marketing sections, and its
     | links are split into what is yours (leagues, boards, Signal) and what the
     | rest of the system offers. Across the other five surfaces, section stacks
     | went from space-y-12 to space-y-6 and section headings dropped a step to
     | text-xl / sm:text-2xl, because in a column beside a rail the old sizes read
     | as a second page title under the masthead's h1.
     | Known and left alone: below xl the rail stacks under the content, so the
     | Signal summary that used to sit at the top of a phone screen is now at the
     | bottom of one. That is what moving it into the rail means, and every other
     | rail on the site behaves the same way.
     | verified: yes (tsc clean, 1747 tests across 122 files, next build clean;
     |           no browser check, at the owner's request)

T624 | completed | Games and Signal Scout join the full-width scheme
     | files: app/games/page.tsx, app/games/signal-scout/page.tsx,
     |        app/games/signal-scout/leaderboard-rail.tsx,
     |        app/games/signal-scout/clue-grid.tsx
     | depends on: T623
     | Signal Scout's leaderboards sat in a 20rem column on the LEFT from lg,
     | which put a board of other people's scores between the reader and the
     | game. They are on the right now, from xl, in the same 340px track and with
     | the same sticky behaviour as every other rail: pinned under the header,
     | capped at the viewport, scrolling inside itself, focusable so that scroll
     | reaches the keyboard.
     | Moving it also simplified the markup. The old layout rendered the game
     | first in DOM and then placed the sidebar into column one with explicit
     | grid placement, purely so a keyboard reached "Start scouting" before the
     | boards. With the rail on the right, plain markup order does that on its
     | own, and content-then-complementary is still a meaningful sequence.
     | The breakpoint moved from lg to xl, matching the Brief and the profile, so
     | between 1024 and 1280 the boards ride in the same slide-up sheet a phone
     | gets rather than squeezing the game into two thirds of a narrow column.
     | The clue grid goes three across at 2xl. The game column runs to about a
     | thousand pixels now, and two columns at that width left each clue cell
     | mostly whitespace.
     | The games index got the same treatment as the other story pages: masthead
     | across the shell with two live stats, the cards in a panel rather than
     | under a text-4xl heading that competed with the h1, and a rail carrying
     | what a player wants to know before starting (built on the same data as the
     | rankings, no account needed, keyboard and screen reader throughout) plus
     | three links out.
     | The rail then earned three more changes. How It Works keeps its collapsed
     | default (it is reference material), but its six rules are bordered cards
     | now, each with its own icon and heading, and the four hint tiers are rows
     | carrying the tier chip and its live cost rather than a run-on list. My
     | Scout Record moved into the rail above the boards, because your record and
     | everyone else's are the same kind of thing and the game column should hold
     | the game. The board tabs went to 36px with a tighter frame in the rail,
     | where a pointer is the input; the sheet copy keeps its 44px targets.
     | The masthead is handed to the game client as a slot and disappears the
     | moment a round is live, the same call On The Clock makes with the draft
     | room's hero. That cost two headings: with the masthead gone mid-round the
     | page would have carried no h1, so the client renders a visually hidden one
     | and the "Play Signal Scout" heading moved in with it, in that order. It
     | used to be declared a level up, where it preceded the h1 it belongs under.
     | Trade-off worth knowing: the masthead now sits inside the game column, so
     | at xl it is as wide as the game rather than as wide as the page. It has to
     | live there for the game to be able to take it away.
     | The round itself was then rebuilt to look like a game rather than a stack
     | of bordered paragraphs.
     | A mission header stands where the masthead was and carries the page's h1
     | while a round runs, so the visually hidden h1 that was holding that slot
     | is gone. It has two states, one for a live round and one for the reveal.
     | The scouting file is an actual file now: a header strip with a CLASSIFIED
     | stamp, the silhouette under its scanline, and three labelled fields whose
     | values are blacked out, with the redactions aria-hidden and one plain line
     | carrying the same meaning to a screen reader.
     | The hint buttons read as buttons: the tier name in the heavy uppercase the
     | site uses for headings, the cost and the signals left as supporting text
     | under it, 5rem tall, two-up until 2xl. The whole Buy a hint section sits on
     | its own purple-lit panel, because spending score is the decision the round
     | turns on.
     | ScoutSectionHead gives every section of the round the same header shape
     | (icon chip, eyebrow, title) with a tone that says what kind of section it
     | is: cyan to read, purple to act, danger for what went wrong. Buy a hint,
     | Make the call, Bad Reads, and the clue grid all use it.
     | The panel that wrapped the whole round is gone. Every section inside it
     | now carries its own surface, so the wrapper was a box around boxes, and
     | removing it also means the guess combobox's listbox can no longer be
     | clipped by an ancestor's overflow-hidden.
     | verified: yes (tsc clean, 1747 tests across 122 files, next build clean;
     |           no browser check, at the owner's request)

T625 | completed | League header down to one row, refresh into the rail
     | files: components/league-header-actions.tsx,
     |        components/copy-link-button.tsx,
     |        components/league-shell/league-rail-sections.tsx,
     |        components/league-shell/league-shell.tsx,
     |        components/app-shell/nav-icons.ts, lib/use-league-refresh.ts,
     |        components/refresh-button.tsx (deleted)
     | depends on: T624
     | The deep view's header cluster held three controls and needed two rows on
     | a phone: the switcher and Copy link split 50/50, with Refresh below them.
     | It is one row now. The switcher takes the width and Copy link is a square
     | glyph beside it, because switching leagues is what people reach for and
     | copying a link is what they occasionally do. The copy button keeps its
     | label from sm up through a new `compactBelowSm`, so nothing is lost on the
     | layout that has room, it keeps a 44x44 target where the label is gone, and
     | the glyph turns into a checkmark to confirm a copy the label can no longer
     | announce.
     | Refresh moved into the league's section of the navigation rail as a row
     | that acts in place (`onSelect`), which also puts it in the mobile drawer,
     | where the header cluster never reached. Its fetch moved to
     | lib/use-league-refresh.ts so the control could live somewhere other than
     | where the code was written, and components/refresh-button.tsx is deleted
     | rather than left behind unused. The row's hint carries the outcome of the
     | last attempt, since a rail row has nowhere to put an error, and a live
     | region beside the registration carries the same thing by ear.
     | NOT GATED, deliberately, and worth writing down because the request
     | described it as admin-only: force refresh was reclassified as public under
     | FFB-SEC-004 / FFB-SEC-007. The route has no auth check, it is protected by
     | a shared per-league cooldown, and lib/security/league-refresh-public.test.ts
     | fails CI if a commissioner or admin gate is reintroduced. Nothing here
     | changed who can press it. CLAUDE.md still describes the older admin-gated
     | design and is stale on this point.
     | Also: the league section rendered "League overview" and "Overview" as two
     | rows pointing at the same page. The section carried an href, which draws an
     | index row above the children, and Overview is already the first child. The
     | href is gone, the way the player profile's section and the draft room's
     | already do it, so the section opens straight onto its five rows.
     | verified: yes (tsc clean, 1747 tests across 122 files; no build and no
     |           browser check, at the owner's request)

T626 | completed | Stop filtering Sleeper starter placeholders at write time
     | files: lib/league-matchups.ts
     | depends on: none
     | Sleeper's `starters` array is POSITIONAL: `starters[i]` is the player in
     | the i-th startable slot of roster_positions, and an unfilled slot is the
     | string "0". The sync filtered that placeholder out on the way in, which
     | shifted every slot below it up by one. Nothing had noticed, because the
     | only reader (lib/power-pulse/load.ts loadSchedule) treats the array as an
     | unordered set and drops "0" itself. `starters_points` was never filtered,
     | so the two arrays already disagreed with each other from the other end.
     | The new Schedule page reads the array positionally and would have put
     | players in the wrong slots for any league with an empty starting slot.
     | Both arrays now go in verbatim through `normalizeIdList`, and readers
     | filter. No migration: rows written before this keep the filtered array,
     | and `metadata` holds the Sleeper object verbatim for the fallback, which
     | is the backfill case the CLAUDE.md metadata rule exists for. A `force`
     | pulse rewrites a league correctly.
     | verified: no (test lands in T669)

T633 | completed | Add Schedule to the league navigation, rename Trade Finder
     | files: components/league-shell/nav-items.ts,
     |        components/app-shell/nav-icons.ts
     | depends on: none
     | One edit rather than two, because both changes touch the same list and a
     | half-renamed LeagueTabId does not compile. `schedule` is added between
     | Teams and Power Pulse (Overview and Teams say who is in the league,
     | Schedule says what happens to them, Power Pulse is the model built on the
     | schedule). `trade-finder` becomes `trade-ideas` with the label "Trade
     | Ideas" and a hint naming both halves of what it now does. Both new full
     | routes join the `leagueTabHref` branch. `calendar` (lucide CalendarDays)
     | added to the icon map. The desktop rail and the mobile drawer both read
     | this one list, so neither needed touching.
     | verified: yes (tsc clean)

T653 | completed | Route rename plus permanent redirect
     | files: app/leagues/[league_id]/trade-ideas/ (git mv from trade-finder/),
     |        app/leagues/[league_id]/trade-ideas/page.tsx,
     |        app/leagues/[league_id]/page.tsx, next.config.ts
     | depends on: T633
     | `git mv` so history follows. The page's activeTab, copyHref, copy aria
     | label, breadcrumb, TeamChooser links, title and description all updated;
     | the visible h2 is now "Trade Ideas". next.config.ts gains a permanent 308
     | for `/leagues/:league_id/trade-finder`, in the routing layer so an old
     | shared link never renders the dead path.
     | DEVIATION from the plan, recorded there too: components/trade-finder.tsx
     | and components/trade-finder-card.tsx keep their filenames. They are named
     | after lib/trade-finder/, which is also keeping its name, and they are
     | imported by the dashboard portfolio panel as well. Moving them changes
     | nothing a reader sees and starts every future `git log --follow` on the
     | most complicated client component in the feature with a rename.
     | verified: yes (tsc clean after clearing stale .next/types)

T667 | completed | Shared rate-limit claim helper
     | files: lib/rate-limit-claim.ts, app/actions/trade-finder.ts
     | depends on: none
     | `claimSlot` inside app/actions/trade-finder.ts was about to be written a
     | second time for a SERVER RENDERED path, and two copies of a limiter is how
     | one of them ends up with the wrong window. The mechanism (derive the actor
     | through resolveRateLimitActorKey, then the try_claim_rate_limit RPC on the
     | admin client) now lives in one place and takes its bucket, ceiling and
     | window from the caller. Fails closed, same as before. The trade-finder
     | action keeps a thin local `claimSlot` so its two call sites are unchanged.
     | verified: yes (tsc clean, 1780 tests green)

T668 | completed | Trade evaluation rate limit, one bucket for all three paths
     | files: lib/trade-impact/rate-limit.ts
     | depends on: T667
     | An evaluation is two Monte Carlo seasons plus 40 to 80 exact lineup fills,
     | and it has three entry points: the server action, the server rendered page
     | path (`?mode=build&in=...&out=...` is decoded and evaluated during render,
     | so a loop over GET requests runs the same work without touching the
     | action), and the streamed evaluation under the on-screen suggestion. All
     | three claim from ONE bucket at 10 per minute per actor, below the finder's
     | 12, because one evaluation costs more than one search. One bucket rather
     | than three so a caller cannot alternate paths to spend three budgets.
     | Callers validate BEFORE claiming, so a stale link cannot burn a reader's
     | budget and garbage input gains an attacker nothing.
     | verified: yes (tsc clean)

T654 | completed | User-facing "Trade Ideas" copy, and Schedule in Explore
     | files: components/trade-finder-panel.tsx, components/league-quick-links.tsx,
     |        components/trade-finder.tsx, components/league-shell/league-masthead.tsx,
     |        components/league-shell/league-mobile-nav.tsx,
     |        app/leagues/[league_id]/page.tsx
     | depends on: T653
     | Every string a reader sees now says Trade Ideas: the cross-league panel
     | title, the My Sleeper Leagues quick link and its aria-label, and the
     | league overview's Explore list. The filenames and the lib directory keep
     | the old name on purpose (see T653).
     | The Explore rail on the league overview also gains a Schedule row, since
     | that rail is the other way into a section and a new section missing from
     | it would be reachable only from the nav.
     | `grep -rn "Trade Finder" components/ app/ --include=*.tsx` returns nothing.
     | verified: yes (tsc clean)

T660 | completed | URL encoding for a built trade
     | files: lib/trade-impact/proposal-url.ts, lib/trade-impact/proposal-url.test.ts
     | depends on: T646
     | The builder could have kept its state in React and posted it to an action.
     | That would be less code, and it would make a trade you spent two minutes
     | assembling unshareable, unbookmarkable, and destroyed by the back button.
     | The proposal lives in the query string instead, so the page renders the
     | evaluation server side from it.
     | `myRosterId` is taken from the PAGE, never from the link. If the link could
     | move it, one person could send another a link that quietly evaluates
     | somebody else's team. There is a test for that specifically.
     | Duplicates collapse before the six-per-side cap applies, so a link padded
     | with repeats cannot push real assets out of the window (also tested).
     | Unreadable tokens are counted and reported rather than silently dropped, so
     | the reader is told the link is partial instead of being shown a quietly
     | smaller trade than the one shared with them.
     | The parser does shape validation ONLY. It cannot know a player is on the
     | roster he is claimed to be on; that check needs the database and belongs in
     | evaluate.ts. The split is deliberate: shape validation is cheap and runs
     | BEFORE the rate-limit claim, so a stale link cannot burn a reader's budget.
     | Separator note, worth recording because the first attempt was wrong: tilde
     | is unreserved in RFC 3986, which sounds like it survives a URL round trip
     | and does not. URLSearchParams serializes as application/x-www-form-urlencoded,
     | whose safe set is alphanumerics plus * - . _ only, so a tilde came back as
     | %7E. A test caught it. Underscore survives untouched.
     | verified: yes (23 tests, tsc clean)

T651 | completed | Grade any pair of asset lists, not only a TradeSuggestion
     | files: lib/trade-finder-grade.ts
     | depends on: none
     | The builder produces a trade nobody suggested: no fingerprint, no
     | acceptance band, no counterparty record, just two asset lists and the name
     | of the team opposite. It still deserves the same Signal Check second
     | opinion the engine's suggestions get, and a reader would rightly distrust a
     | builder whose grade came from somewhere else.
     | So the batching moved onto a new `GradeableTrade` shape and
     | `gradeAssetPairs`, and `gradeSuggestions` became a two line adapter over
     | it. Purely a widening: the batching, the format resolution, the shared
     | resolver, the per-deal try/catch and the null-rather-than-guess contract
     | are all untouched, so nothing about how a suggestion is graded changed.
     | verified: yes (tsc clean, full suite green)

T627 | completed | Slot alignment, labels, and display order for league lineups
     | files: lib/league-schedule/slots.ts, lib/league-schedule/slots.test.ts
     | depends on: T626
     | `alignedStartingSlots` keeps EVERY token that is not BN/IR/TAXI/NA, in the
     | league's own order. That is the alignment key for Sleeper's `starters`
     | array. It deliberately differs from lib/power-pulse/lineup.ts
     | `startingSlots`, which additionally drops tokens it cannot project (IDP).
     | Both are correct for their own caller, and both carry a cross-reference
     | comment so a future reader does not "unify" them and silently reintroduce
     | the slot-shift bug T626 fixed.
     | An unrecognised token is never dropped: it renders in the IDP group with
     | its own label and projectable=false. Dropping it would break alignment.
     | verified: yes

T628 | completed | Read a set lineup from a matchup row, aligned to its slots
     | files: lib/league-schedule/lineups.ts, lib/league-schedule/lineups.test.ts
     | depends on: T627
     | Prefers `metadata.starters` (verbatim Sleeper) over `starter_ids`, because
     | rows written before T626 hold the filtered array. The points array follows
     | the SAME choice, so a metadata id array is never paired with a column
     | points array. Never throws on a short or long array: Sleeper is the source
     | and does not owe us a length. A missing point value is null, not 0.
     | verified: yes

T629 | completed | Matchup view builder: both lineups, projections, totals
T630 | completed | Bench and taxi upgrade calculation
     | files: lib/league-schedule/matchup.ts, lib/league-schedule/matchup.test.ts
     | depends on: T628
     | Projects through lib/power-pulse/project.ts, so a schedule number and a
     | Power Pulse number can never disagree. Unprojectable (IDP) slots render
     | the player with a null projection and raise `unprojectedSlots`, which is
     | what drives the "totals exclude N IDP slots" footnote. A null is never a
     | zero: a zero looks like an answer.
     | Bench upgrades include IR and taxi players tagged `requiresMove`, because
     | Sleeper will not let you start them without a roster move. Each incoming
     | player and each displaced starter appears at most once, so the list reads
     | as independent moves rather than the same starter replaced four times.
     | The single-swap gains deliberately do NOT sum to `pointsLeftOnBench`:
     | taking one swap changes what the next is worth. The total comes from the
     | optimal lineup and both are labelled.
     | verified: yes

T631 | completed | Schedule insights: SOS, all-play luck, stretches, spotlight
     | files: lib/league-schedule/insights.ts, lib/league-schedule/insights.test.ts
     | depends on: none
     | Remaining SOS is read straight off the Power Pulse cache, never
     | recomputed, so the Schedule page and the Power Pulse page cannot disagree.
     | Played SOS is computed here because the cache only looks forward.
     | All-play luck is scored against a hand-worked fixture in the test.
     | Stretch windows require every week in the window to have an opponent
     | projection: averaging 2 of 3 and ranking it against a full 3 would rank a
     | partly-unknown stretch against a known one. "Consecutive" means
     | consecutive among REMAINING weeks, so a bye does not split a stretch.
     | verified: yes

T669 | completed | Power Pulse regression guard: placeholders never reach setLineups
     | files: lib/power-pulse/load.test.ts, lib/league-matchups.test.ts
     | depends on: T626
     | THE test for this whole build. T626 changed a table Power Pulse reads, and
     | the safety argument was that `asStringArray` in lib/power-pulse/load.ts
     | already drops "0" so the read side is unchanged. This checks it rather
     | than trusting it: `loadSchedule` is driven through a fake client with two
     | datasets, one carrying placeholders and one already filtered, and both must
     | produce byte-identical `setLineups` and `weeks`.
     | lib/league-matchups.test.ts guards the write side: a future "cleanup" that
     | reintroduces the filter fails there with a message explaining why.
     | verified: yes (FAAB's 72 tests also re-run green)

T645 | completed | Extract the before/after season simulation out of FAAB
     | files: lib/power-pulse/what-if.ts, lib/power-pulse/what-if.test.ts,
     |        lib/faab/league-faab.ts
     | depends on: none
     | FAAB already built a SimTeam[] for the whole league, swapped one team's
     | weekly distribution, and ran simulateSeason twice. Trade Ideas needs the
     | identical thing with TWO teams changed. One copy now, in
     | `simulateWithReplacements`, which overlays a replacement map onto a
     | baseline without mutating it and returns null when there are no unplayed
     | weeks (nothing to simulate is not the same as zero odds).
     | THE CONTRACT HELD: all 7 lib/faab/*.test.ts files, 72 tests, pass
     | UNCHANGED. No FAAB test was edited. `buildSimTeams` reproduces the deleted
     | `simTeamsFrom` term for term. Net 16 insertions, 37 deletions in FAAB.
     | verified: yes

T647 | completed | Multi-asset roster swap, generalised from the FAAB marginal
     | files: lib/trade-impact/roster-swap.ts, lib/trade-impact/roster-swap.test.ts
     | depends on: T646
     | computeLineupSwap generalised from "add one, drop one" to "add N, remove
     | M", on the same exact-optimal machinery. An incoming player with no
     | projection for a week is simply not a candidate that week, because a
     | missing week is a bye and not a zero. An outgoing bench player costs
     | nothing and the arithmetic shows it without a special case.
     | `incomingStartWeeks` is keyed only by players who had a projection in at
     | least one week: a zero there would read as "we checked and he never
     | starts" when the truth is "we had nothing to check him with".
     | verified: yes (9 tests)

T649 | completed | Reason builder
     | files: lib/trade-impact/reasons.ts, lib/trade-impact/reasons.test.ts
     | depends on: T646
     | Every one of the 20 reason kinds cites a figure present in the input.
     | Nothing is generated, estimated, or rounded into a claim the input does not
     | support; a null figure means the reason does not fire. Same contract
     | lib/trade-finder/explain.ts already holds, and the reason it is templates
     | rather than a language model: every sentence is checkable against the
     | numbers on the same screen, and a plausible-but-wrong one would cost the
     | feature its credibility the first time it was wrong about a real league.
     | Costs are never omitted or truncated by the ordering.
     | Deviations, all recorded by the agent with reasons: `schedule-timing`
     | names the week and the gain but not opponent strength, because that figure
     | is not in the input and inventing it would break the rule; `picks-in` and
     | `picks-out` fire off the actual lists rather than the sign of the net, so a
     | one-for-two pick swap does not hide the pick being sent; `younger`/`older`
     | are gated on dynasty, where the figure means something.
     | verified: yes (69 tests)

T648 | completed | Trade impact read layer
     | files: lib/trade-impact/load.ts
     | depends on: T646
     | THE performance decision in this feature. Turning "your lineup gains 4.3
     | points a week" into "playoff odds go from 41 to 58 percent" needs a weekly
     | distribution for EVERY team, not just the two trading. FAAB gets those by
     | projecting every rostered player in the league: about 350 players and 216
     | exact lineup fills before the trade is even considered.
     | Power Pulse already computed exactly that and stored it in
     | `league_power_pulse_cache.weekly`. So the ten uninvolved teams are READ,
     | and only the two whose rosters change are projected. Roughly 60 players
     | instead of 350, and 4 lineup fills per week instead of 12.
     | The two involved teams use OUR freshly computed baseline on BOTH sides of
     | the comparison, never the cached one. Mixing a cached baseline with a
     | recomputed post-trade lineup would attribute every difference between the
     | two computations to the trade, which is how a deal that changes nothing
     | ends up reporting a swing in playoff odds.
     | Values, ages, pick prices and format context come from
     | `loadTradeFinderLeague`, the same read the suggestion engine uses, so a
     | built trade and a suggested trade are priced identically by construction.
     | verified: yes (tsc clean)

T650 | completed | evaluateTrade orchestration
     | files: lib/trade-impact/evaluate.ts
     | depends on: T645, T647, T648, T649
     | Split into `validateProposal` (cheap: one league read, no projection, no
     | simulation) and `evaluateValidatedTrade` (expensive). The split exists so
     | callers can validate BEFORE claiming a rate-limit slot.
     | OWNERSHIP IS RE-DERIVED, NEVER TRUSTED. The caller says "player X from
     | roster 4"; this checks `rosters.player_ids`. A forged input would otherwise
     | produce a confident, fully reasoned evaluation of a trade that cannot
     | happen, which reads as a correctness bug and behaves as a security one,
     | because the numbers are what a reader acts on.
     | Picks match on season and round only. The slot bucket is our estimate
     | rather than the league's fact, so requiring it to match would reject real
     | picks over a label we chose ourselves.
     | Signal Check runs through the new `gradeAssetPairs` and a failure there
     | costs the reader nothing else.
     | verified: yes (tsc clean)

T652 | completed | evaluateProposedTrade server action with validation and limits
     | files: app/actions/trade-impact.ts
     | depends on: T650, T651, T668
     | Three gates, and their ORDER is the point: shape (zod, no database), then
     | ownership (one league read), then the rate-limit claim, then the expensive
     | half. Reversing the last two would be the obvious build and the wrong one:
     | it charges the honest reader for the dishonest caller's traffic.
     | Sleeper league ids are pattern-matched to digits because the value reaches
     | a PostgREST filter, where an id carrying a comma rewrites the filter rather
     | than being matched by it.
     | Public, deliberately: every figure it returns is derived from league data
     | any visitor already sees on Overview and Power Pulse. The protection is the
     | per-actor limit and the ownership check, not an auth gate.
     | verified: yes (tsc clean)

T632 | completed | Schedule read layer
     | files: lib/league-schedule/data.ts
     | depends on: T629, T631
     | Two functions with very different costs, kept apart on purpose.
     | `loadScheduleBoard` is four queries and no arithmetic: every projected
     | number comes from `league_power_pulse_cache.weekly`, so a twelve team
     | season costs the same as one week and the Schedule page can never report a
     | different projection than the Power Pulse page for the same team and week.
     | `loadMatchupDetail` projects about 60 players for ONE week (the week is
     | filtered on both the query floor and the row), which is a fraction of what
     | pulseLeagueDerived already does on the same visit.
     | verified: yes (tsc clean)

T634 | completed | Schedule controls: view toggle, week stepper, team picker
T635 | completed | Week board and matchup row
T636 | completed | Team season view
T639 | completed | Side-by-side starting lineup table
T640 | completed | Player detail dialog
T641 | completed | Bench upgrades panel
T643 | completed | Empty, partial, and error states for the schedule
     | files: components/league-schedule/{schedule-controls,week-board,matchup-row,
     |        team-season,matchup-table,player-detail-dialog,bench-upgrades,
     |        schedule-empty}.tsx, components/league-schedule/format.ts
     | depends on: T627, T629, T630, T633
     | format.ts is a ninth file nobody asked for and it earns its place: four
     | components render a win-loss record and every one draws the same 120
     | character gradient. Copying either is how "6-2" and "6-2-0" end up on the
     | same page and one panel's purple quietly drifts.
     | The lineup table is a real <table> with the slot as <th scope="row"> in the
     | middle column, so a row reads as "QB, Josh Allen projected 22.4, Patrick
     | Mahomes projected 21.8". Two stacked lists would ask a screen reader user
     | to hold twelve names in their head to compare anything.
     | The table stays a table at 360px: 56px centre column, two-line player
     | cells, headshots 32 to 24. The only responsive hide in the set is
     | TeamSeason's win-probability column, and the same value in the same words
     | renders in the result cell below sm.
     | CORRECTNESS FIX I made on top of the agent's work: `opponentLabel` rendered
     | a bare team code as "vs SF". Sleeper's weekly projections carry `opponent`
     | with no home or away marker (lib/sync-weekly-projections.ts stores the
     | field verbatim), so "vs" would have been printed on every AWAY game too.
     | Home and away is a real distinction to a fantasy manager and inventing it
     | is worse than omitting it. A bare code now renders as itself; a leading "@"
     | is still honoured for the day game_id gets parsed into a venue. Added
     | `opponentWords` for accessible names ("against SF") so the phrasing reads
     | as running text without claiming a venue either.
     | Agent deviations accepted: no player-profile link in the dialog, because
     | /players/[slug] is keyed on `slug` and SchedulePlayer carries a uuid and a
     | Sleeper id; linking on either would 404 on every player. Recorded as a
     | follow-up rather than shipped broken.
     | verified: yes (tsc clean)

T638 | completed | Schedule page
     | files: app/leagues/[league_id]/schedule/page.tsx
     | depends on: T634, T635, T636, T637
     | Built on the Power Pulse page's structure: pulseLeagueCore awaited in the
     | page so the masthead, the tabs and the intro paint, everything that needs
     | pulseLeagueDerived behind a Suspense boundary. One React cache() wrapper
     | holds the derived sync, the single getNflState call inside
     | resolveScheduleWeek, and the board read, so the intro chips and the body
     | share all three instead of racing to do each twice.
     | An out-of-range `?week=` lands on the nearest real week rather than an
     | empty page: a shared link naming week 20 is a link somebody will click.
     | `?roster=` falls through to the searched Sleeper handle's own team, then
     | to the first team, so the team view never opens on nothing.
     | Projected wins is one narrow read for the one team on screen. TeamSeason
     | renders "Power Pulse has not scored this league yet" on a null, and that
     | sentence is false on a league it HAS scored, so a null was not an option.
     | T637's three rail panels are rendered in this page rather than as three
     | component files: each is a Panel plus one insights call, and none of them
     | is reused anywhere else.
     | verified: yes (tsc clean, next build clean, 1962 tests green)

T642 | completed | Matchup detail page
     | files: app/leagues/[league_id]/schedule/[week]/[roster_id]/page.tsx
     | depends on: T639, T640, T641
     | Week and roster are validated off the route segments before any query
     | runs, so a typed URL is a 404 rather than a query carrying a NaN.
     | `reason: "not-found"` gets a NAMED panel, not the generic 404 shell: the
     | league is real and the week is real, so a reader who followed a shared
     | link needs to be told which of the four parts did not line up, plus a way
     | back to that week on the board.
     | orderSlotsForDisplay is deliberately NOT called here. MatchupTable groups
     | the paired rows by position block and sorts on the league's own slot order
     | inside each block, which is the same ordering; applying it in both places
     | buys nothing and creates a second answer to keep in sync.
     | The rail's season series and recent form both come from one
     | loadScheduleBoard call rather than two bespoke queries, so this page and
     | the board can never disagree about how many times a pairing appears.
     | verified: yes (tsc clean, next build clean)

T644 | completed | OG card for a matchup
     | files: app/api/og/matchup/[league_id]/[week]/[roster_id]/route.tsx
     | depends on: T642
     | FF Beacon palette only, following the team card: #07070D to #0F0F1A, the
     | purple to cyan beacon gradient, the wordmark, the ffbeacon.com footer.
     | resolveLeagueContext is NOT called, and the file says why: nothing on this
     | card is a value, so the resolver would buy a source label for a card with
     | no sourced number on it.
     | It syncs nothing either. A crawler fetching an image is not a reason to
     | hit Sleeper, and a share card that triggered a league sync would let
     | anyone with a URL schedule work on our side.
     | The win probability is printed as a percentage rather than drawn as a bar.
     | A share image carries no alt text of its own, so anything it only draws is
     | information it does not carry.
     | verified: yes (tsc clean, next build clean)

T666 | in_progress | Document the schedule feature and the impact model
     | files: CLAUDE.md
     | depends on: T644, T665
     | CLAUDE.md updated ahead of the review pass, because the ABSOLUTE RULEs it
     | now carries are exactly what a reviewer should be checking against.
     | Added: the Schedule route pair and why the matchup detail is keyed on week
     | plus roster rather than the nullable matchup_id; the positional-starters
     | rule with the two tests that hold it; why alignedStartingSlots and
     | startingSlots must not be unified; the null-is-not-zero rule for IDP; the
     | no-venue-claim rule for Sleeper's bare opponent code; and for Trade Ideas
     | the three rate-limited paths sharing one bucket, validate-before-claim,
     | ownership re-derivation, reasons-are-templates, and the one copy of the
     | before/after simulation.
     | The docs/ implementation report is still to write.
     | verified: partial (route sections done, report pending)

T659 | completed | Trade builder
     | files: components/trade-ideas/trade-builder.tsx
     | depends on: T652, T658
     | EVALUATE IS A LINK, NOT A FETCH. The obvious build calls the server action
     | and drops the result into local state, which is fewer moving parts and
     | leaves the answer living nowhere: unshareable, unbookmarkable, destroyed
     | by the back button. The deal is encoded into the query string instead and
     | the page renders the evaluation server side from it, which also means one
     | code path turns a proposal into a verdict, and it is the one that runs the
     | ownership check and the rate-limit claim in the right order.
     | The link carries `#trade-evaluation`, whose target section is rendered
     | OUTSIDE the evaluation's Suspense boundary so it exists at first paint
     | rather than appearing when the result streams in.
     | The running totals are addition over data already in the browser. Waiting
     | on a round trip to learn you are 2,000 short would make the builder
     | useless for the thing it is for.
     | An asset in the URL that its claimed team no longer holds renders as a
     | named row saying so and is left out of the totals, rather than vanishing
     | or being counted at zero. The server rejects the same trade for the same
     | reason; this is the client naming which piece went stale.
     | Picker commits on its own Add button, not on the select's change event:
     | committing on change would close the dialog on whichever name a keyboard
     | user happened to arrow past.
     | Cap of 6 per side (MAX_BUILD_ASSETS_PER_SIDE) is stated as a real
     | paragraph in the panel, not only as a description on the Add button, since
     | a disabled button leaves the tab order and takes its description with it.
     | verified: yes (tsc clean, 1962 tests green)

T661 | completed | Trade Ideas page, both modes, rate limited on the render path
     | files: app/leagues/[league_id]/trade-ideas/page.tsx
     | depends on: T654, T655, T659, T660, T668
     | THE SERVER RENDERED EVALUATION RUNS THE SAME THREE GATES AS THE ACTION, IN
     | THE SAME ORDER: decodeProposal (shape, free), validateProposal (ownership,
     | one league read), claimTradeEvaluationSlot, then evaluateValidatedTrade.
     | Validation before the claim so a stale link cannot burn a reader's budget
     | and garbage gains an attacker nothing.
     | DEGRADES, NEVER THROWS. A failed claim renders EvaluationState
     | kind="rate-limited" in the evaluation slot and the league, tabs, builder,
     | and rail render normally. A 429 for the whole document would punish a
     | reader for using the feature correctly and take the navigation with it.
     | `mode !== "build"` is byte-for-byte the previous behaviour: same streamed
     | TradeFinderSection, same suggestion browser.
     | Build mode's league read is wrapped in React.cache keyed on primitives, so
     | the builder's asset lists, the rail's figures, and the identity resolution
     | are one read rather than three.
     | The evaluation section renders always, with kind="empty" when the URL
     | carries no trade, so `#trade-evaluation` is a stable anchor and an empty
     | builder still tells the reader where the answer will appear.
     | Format stays the league's own through resolveLeagueContext; only the value
     | source follows the reader. `?format=` is still ignored here.
     | KNOWN COST, recorded rather than hidden: validateProposal calls
     | loadTradeImpactWorld, which calls loadTradeFinderLeague again, so build
     | mode reads the finder league twice per evaluated request. Fixing it means
     | a React.cache inside lib/trade-finder-data.ts, which is a separate change.
     | verified: yes (tsc clean, 1962 tests green)

T663 | completed | Open a suggestion in the builder
     | files: components/trade-finder-card.tsx, components/trade-finder.tsx
     | depends on: T659
     | `builderHref` is OPTIONAL on the card and that is load bearing: the same
     | card renders on the cross-league portfolio panel, where a deal can come
     | out of any league and there is no single league page to open it in.
     | Omitted, the control is not drawn. The existing card contract is unchanged.
     | A suggested pick becomes `{kind:"pick", season, round, pickPosition:"mid"}`.
     | SuggestionAsset carries no slot bucket, evaluate.ts matches a proposed pick
     | on season and round alone, and "mid" is what lib/league-pick-position.ts
     | falls back to for an unknown slot, so the feature has one answer for it.
     | The href is null unless the deal belongs to the league the surface is
     | showing, which also covers a bookmark naming a league the reader has left.
     | verified: yes (tsc clean, 1962 tests green)

T664 | blocked | Save a built trade through the existing fingerprint
     | files: lib/trade-finder-saves.ts, components/trade-ideas/trade-builder.tsx
     | depends on: T659
     | NOT DONE, and deliberately not done. `savedSuggestionSchema` is `.strict()`
     | and requires `acceptance`, `qualityRatio`, `score`, `headline`, `whyYou`,
     | `whyThem`, `pitch`, and `counterparty.direction`. A built trade produces
     | none of them: they are outputs of the suggestion engine, which never ran.
     | Filling them to satisfy the schema would put an invented acceptance band
     | ("Likely" / "Long shot") on the card for a deal nothing graded that way.
     | Two smaller mismatches on top: ResolvedAsset picks carry `pickPosition`,
     | which the strict pick schema rejects, and both sides are `.min(1)` while a
     | proposal is allowed to be one-sided.
     | suggestionKey() would give a valid tf1- key; the key was never the problem.
     | Widening the schema is the wrong trade: the bound is what stops that column
     | becoming general storage, per the file's own header. A follow-up task
     | should decide what a saved BUILT trade actually is, which is a stored
     | TradeImpact rather than a stored TradeSuggestion.

T637 | completed | Quick stat rail panels (folded into the schedule page)
     | files: app/leagues/[league_id]/schedule/page.tsx
     | depends on: T631
     | Planned as three component files. Built as three Panels inside the page
     | instead, because each is a `Panel` wrapping one `insights.ts` call with no
     | second caller. Three files whose only job is to forward props are three
     | more places for the rail to drift out of step with itself.
     | verified: yes (next build clean)

T655 | completed | Mode tabs
T662 | completed | Stream the full evaluation under the on-screen suggestion
T665 | completed | Your team right now rail panel
     | files: components/trade-ideas/mode-tabs.tsx,
     |        components/trade-ideas/your-team-panel.tsx,
     |        app/leagues/[league_id]/trade-ideas/page.tsx
     | depends on: T653, T661
     | Mode tabs are real links carrying `?mode=`, never client state, so both
     | modes are linkable and the server can render either without hydration.
     | The evaluation streams behind its own Suspense boundary with the
     | `#trade-evaluation` anchor rendered OUTSIDE it, so the anchor exists at
     | first paint rather than appearing when the result arrives.
     | verified: yes

T648b | completed | Stop the build path reading the finder league twice
     | files: lib/trade-impact/load.ts, lib/trade-impact/evaluate.ts,
     |        app/leagues/[league_id]/trade-ideas/page.tsx
     | depends on: T650, T661
     | Found by the page agent and reported rather than papered over, which is
     | why it got fixed. `validateProposal` called `loadTradeImpactWorld`, which
     | re-read the whole finder league even though the page had already loaded it
     | for the builder, the rail, and the identity resolution: same query, same
     | answer, twice the work on the hot path.
     | `loadTradeImpactWorld` and `validateProposal` now accept an optional
     | preloaded `finder`. The page hands over the object its React-cached
     | `loadBuilderLeague` already produced. The server action has nothing to hand
     | over and passes nothing, which is the default.
     | Chosen over adding React `cache` inside lib/trade-finder-data.ts, which
     | would pull React into a module that unit tests import.
     | verified: yes (tsc clean, next build clean, 1962 tests green)

T670 | completed | Review fixes: trade impact correctness and metering
     | files: lib/trade-impact/evaluate.ts, lib/trade-impact/roster-swap.ts,
     |        lib/trade-impact/reasons.ts, lib/trade-impact/rate-limit.ts,
     |        lib/trade-impact/proposal-url.ts, lib/trade-impact/evaluate-internals.test.ts,
     |        lib/trade-impact/reasons.test.ts, app/actions/trade-impact.ts,
     |        app/leagues/[league_id]/trade-ideas/page.tsx
     | depends on: T650, T652, T661
     | Four review agents (implementation, security, accessibility, performance)
     | audited the build. These are the findings in the trade-impact cluster.
     |
     | CRITICAL 1, positionAfter never included the players you acquire.
     | `buildRosterWeeks(world, myRosterId, outgoingSleeperIds)` is the roster
     | MINUS what you send, and nothing was ever added back. Its only consumer is
     | the depth-cost reason, which prints to the reader, so trading a receiver
     | for a BETTER receiver reported that you had gutted your receiving corps.
     | Now derived through `applySwap`, which filters out what leaves and
     | concatenates what arrives.
     |
     | CRITICAL 2, the depth-cost figure was a season total printed as a per-week
     | rate. `positionPoints` accumulated inside the week loop and never divided,
     | while the sentence says "points a week". With ten weeks left the number was
     | ten times too large, which also pushed it permanently past the 0.5 noise
     | threshold meant to keep the reason quiet, so it fired on nearly every
     | trade. `positionPointsFrom` now divides by the week count.
     | Both bugs lived in the one file with no test. That is the actual lesson,
     | and lib/trade-impact/evaluate-internals.test.ts is the answer to it.
     |
     | HIGH, valueBefore excluded draft picks while valueDelta included them, so
     | `valueAfter = valueBefore + valueDelta` was inconsistent with itself and
     | the percentage-of-roster threshold the value reasons fire on was skewed.
     | In dynasty picks are a large share of what a rebuilding team owns, which is
     | exactly the team the value figure is for. `teamValueOf` now counts them
     | when the league prices them.
     |
     | HIGH (security + performance, found independently by both), the rate-limit
     | claim sat behind the expensive database half. `validateProposal` called
     | `loadTradeImpactWorld` (about twenty round trips plus a megabyte of
     | projection rows) BEFORE the ownership comparison, and a proposal naming a
     | player who is not on the roster failed validation and therefore never
     | reached the claim. Garbage was the cheapest way to spend our database,
     | because garbage was the one input that skipped the meter.
     | Now: validation reads ONLY the finder league and the world load moved
     | inside `evaluateValidatedTrade`, behind the claim. Plus a second, loose
     | outer meter (`claimTradeEntrySlot`, 60/min) claimed before any read at all,
     | so even shape-valid-but-wrong traffic is bounded. The stale-link property
     | survives: a reader who clicks a dead link still spends no evaluation slot.
     |
     | HIGH (security), the suggestion engine ran on every GET with no limit while
     | the identical work behind the Search button was capped at 12/min. `mode`
     | defaults to suggested, so loading the page ran `findTrades` and graded the
     | shortlist, and `force-dynamic` meant no CDN absorbed it. An attacker never
     | pressed Search. `claimTradeSuggestionSlot` at 12/min now matches the
     | action's own ceiling. Inherited from the old trade-finder page rather than
     | introduced this week, but this is where it lives now.
     |
     | HIGH (performance), five projection passes where two suffice.
     | `buildRosterWeeks` was called five times over overlapping player sets, two
     | of them byte-identical repeats. At 30 startable players and 14 remaining
     | weeks that is about 1260 redundant projectPlayerWeek calls per evaluation,
     | each a stat-line dot product over ~30 keys. Each roster is now projected
     | once and every after-state derived by filtering.
     |
     | HIGH (performance), weakestSlotOf rebuilt every weekly lineup a third time,
     | 28 exact augmenting-path fills, to recover per-slot points that
     | computeRosterSwap had already computed and discarded. `RosterSwapResult`
     | now carries `slotPointsBefore` / `slotPointsAfter`, and weakestSlotOf is an
     | argmin over an array. 84 lineup fills per evaluation down to 56.
     | While testing that I found a genuine limit and documented it rather than
     | papering over it: buildOptimalLineup guarantees the optimal TOTAL, not a
     | canonical assignment across interchangeable slots, so a 19-point receiver
     | can seat in FLEX and leave the WR slot's own figure unmoved. The
     | `fills-hole` reason already gates on the weakest slot actually improving,
     | so it stays silent rather than reporting a slot that did not change. That
     | is the right failure and there is now a test pinning it.
     |
     | MEDIUM, raw Sleeper tokens reached the reader: "Your SUPER_FLEX goes
     | from...". Routed through `slotLabel`.
     |
     | MEDIUM, a PACKAGE-level age delta was described as a ROSTER-level one
     | ("It makes your roster 7.0 years younger"), which is arithmetic no single
     | trade does to a thirty-man roster. Reworded to name what was measured. The
     | test that asserted the old copy was updated, with a comment saying why
     | editing it was correct: it was asserting the bug.
     |
     | LOW (security), the server-rendered evaluation could throw past its Suspense
     | boundary and replace the whole document, which is exactly what that
     | component exists to prevent. Wrapped in try/catch.
     |
     | MEDIUM (security), the comment in proposal-url.ts claimed a property the
     | code does not have: `?roster=` really can name whose team is evaluated.
     | Rewritten to say what is true and why it is acceptable (every figure is
     | already public on Overview and Power Pulse) rather than asserting a
     | guarantee someone would later rely on.
     |
     | MEDIUM (performance), TradeFinderSection bypassed the request-scoped cache
     | and called loadTradeFinderLeague directly. Harmless today because the modes
     | are mutually exclusive, and a loaded gun. Routed through loadBuilderLeague.
     | verified: yes (tsc clean, 111 tests in lib/trade-impact)

T671 | completed | Review fixes: accessibility
     | files: components/slide-up-dialog.tsx,
     |        components/trade-ideas/{trade-builder,trade-verdict,your-team-panel}.tsx,
     |        components/league-schedule/{matchup-table,team-season,schedule-controls,
     |        bench-upgrades}.tsx
     | depends on: T639, T659
     |
     | CRITICAL, choosing an asset tore focus out of the Add dialog. The builder
     | passed `onClose={() => setPicker(null)}`, an inline arrow whose identity
     | changes every render, and SlideUpDialog listed `onClose` in its effect
     | deps. Picking a name re-rendered the parent, which ran the effect cleanup,
     | which restored focus to the button BEHIND the modal, and the effect then
     | re-focused the Close button. The picker's "Moving to the list" announcement
     | became a lie and the next Enter closed the dialog without adding anyone.
     | Fixed at both ends: the caller memoizes, and SlideUpDialog holds onClose in
     | a ref with deps reduced to [open], so no future caller can trip it. The
     | matchup table had the identical pattern and escaped only because it held no
     | other state; it got the same treatment. WCAG 2.4.3 and 3.2.2.
     |
     | HIGH, the lineup table's left column had no row header. A `th scope="row"`
     | is assigned only to cells that FOLLOW it in the row, and the slot sits in
     | the MIDDLE column, so the home side got nothing. The body survived on
     | self-contained aria-labels; the footer did not, and a blind reader checking
     | their own totals heard "118.2, 121.4, 125.7, +7.3" with no way to tell
     | Final from Projected from Best lineup from Difference. Explicit `headers`
     | now associate both data cells with both their column and their row. The
     | file's header comment claimed the opposite and was rewritten. WCAG 1.3.1.
     |
     | Also fixed: the disabled "Add to the deal" button gave no reason and left
     | the tab order taking its description with it (now a visible note, matching
     | the precedent the same file already set for the six-asset cap); the running
     | totals region was a bare aria-live without aria-atomic, so it could
     | announce only the diffed words; two bare "N/A" strings that screen readers
     | pronounce inconsistently; invalid <p> children of <dl> grouping divs; "3th"
     | for a third-round pick; a <details> summary with no visual affordance;
     | the unprojected-slots footnote reporting one side's count for both; and the
     | week steppers hiding their disabled reason from the tab order.
     |
     | Confirmed correct and deliberately NOT changed: the md:hidden / hidden
     | md:block duplication in trade-verdict (both resolve to display:none at the
     | opposite breakpoint, so the subtree leaves the accessibility tree and
     | nothing is announced twice), all six responsive-hide sites (every one
     | paired with a mobile equivalent), and the scope="colgroup" group rows.
     | verified: yes (tsc clean, 135 files / 1980 tests green)

T662 | revised | Suggested mode and build mode converge, one press apart
     | files: components/trade-finder-card.tsx
     | depends on: T661, T663
     | RECORDED HONESTLY, because the first entry for this task claimed more than
     | shipped and an implementation review caught it. `TradeVerdict` has one call
     | site and it is reachable only from build mode.
     | What IS true: every suggestion card already carries the Signal Check
     | verdict, the lineup change per week for both sides, the value delta, the
     | value gap, the age, the acceptance band and the reasons. What lives one
     | press away in the builder is the rest of the same evaluation: projected
     | wins and playoff odds before and after, and the week by week strip against
     | the real remaining schedule. The two modes render the IDENTICAL component
     | from the IDENTICAL engine; they are one navigation apart, not two answers.
     | Why not inline: the suggestion browser pages through the shortlist client
     | side with no round trip, on purpose. A server-rendered verdict pinned under
     | it would describe suggestion 1 while the card showed suggestion 3, which is
     | worse than not having it. Putting the index in the URL would fix the
     | correctness and cost a round trip per arrow press, which is the thing the
     | browser was built to avoid.
     | So the card's control now names the payoff rather than the destination:
     | "Full impact and edit / Playoff odds, week by week, and change any piece",
     | on the accent border. "Open in builder" made the rest of the evaluation
     | sound like a detour to a different tool.
     | Also fixed here: two bare "N/A" readouts, which screen readers pronounce
     | inconsistently, now read "Not available".
     | FOLLOW-UP if inline is wanted: put the shortlist cursor in the URL and
     | accept the round trip, or evaluate the whole shortlist behind one claim and
     | ship it with the suggestions. Both are real options; neither is free.
     | verified: yes (tsc clean, 135 files / 1980 tests green)

T672 | completed | Review fixes: schedule correctness and query cost
     | files: lib/power-pulse/load.ts, lib/league-schedule/{data,matchup,types}.ts,
     |        lib/league-matchups.ts (comment only),
     |        app/leagues/[league_id]/schedule/page.tsx,
     |        app/leagues/[league_id]/schedule/[week]/[roster_id]/page.tsx,
     |        app/api/og/matchup/[league_id]/[week]/[roster_id]/route.tsx,
     |        lib/league-schedule/matchup.test.ts
     | depends on: T632, T638, T642
     |
     | HIGH (performance), the matchup detail read the REST OF THE SEASON's
     | projections to render one week. `loadProjections` only ever applied
     | `.gte("week", fromWeek)` and the ceiling was applied in JavaScript after
     | the rows crossed the wire. Measured on the live database: 261ms and 306
     | rows against 1.0ms and 16 rows with a real ceiling. At 60 players that is
     | roughly 1 MB transferred to use 54 KB, and 1080 rows exceeds the internal
     | 1000-row page size so it also paid a second keyset round trip and an
     | oversized count guard. `loadProjections` now takes an optional `toWeek`.
     | PURELY ADDITIVE: an omitted `toWeek` builds a byte-identical query, and the
     | five other callers pass four arguments and are untouched.
     |
     | HIGH (implementation), the week board showed ONE bench-loss figure on every
     | future week. `lineup_points_lost` is computed once per team, graded against
     | the lineup set right now, and it was stamped onto weeks 8 through 14 for
     | lineups that do not exist yet. Now non-null on the current week only.
     |
     | HIGH (implementation), the settled-week bench retrospective was computed
     | from PROJECTIONS. The panel asserted "You left 12.4 points on the bench in
     | week 3" about a week that had been played, from a projection-based
     | comparison. Actual per-player points were already loaded and the lineups
     | module's own doc said they existed for exactly this. A single `gradePoints`
     | switch now drives the optimal fill, the gap AND every swap's gain, so the
     | panel cannot report an actual-based total under projection-based sentences.
     | Five new tests, including one where the projections say the lineup was
     | perfect and the box score says 15 points sat on the bench.
     |
     | MEDIUM, bench upgrades could not recommend FILLING AN EMPTY SLOT. A manager
     | who left a WR slot empty was told to displace their weakest occupied WR,
     | and the hole was counted in the total but never explained, which is why the
     | two numbers diverged most on the roster that needed the nudge most.
     |
     | MEDIUM (performance), generateMetadata duplicated four queries the page
     | then made again. Both pages now share a React-cached `getSyncedLeague`.
     | The agent found and avoided a trap worth recording: `pulseLeagueCore` had
     | to move INSIDE the cache, because a league nobody has opened does not exist
     | in our tables until that call writes it, so a cached read racing ahead of
     | the sync would cache null and 404 a brand new league.
     |
     | MEDIUM (performance), `loadMatchupDetail` read `rosters` and `league_users`
     | twice because `RosterRow` carried the team name but not the owner handle or
     | avatar. Both added to the join `loadRosters` already does; two round trips
     | removed per matchup render and per OG image.
     |
     | LOW (security), `roster_id` was unbounded on the matchup route and the OG
     | route, which accepted negatives. Both bounded to 64 before any query. The
     | cost per bogus id was flat, but the OG route sets s-maxage=3600, so an
     | attacker could fill the CDN with distinct 404 images.
     |
     | MEDIUM (accessibility), bare "n/a" and "N/A", which screen readers
     | pronounce inconsistently, replaced with words on both pages.
     |
     | Also: `player_ids` dropped from the matchup select (nothing read it), and
     | the justification comment in lib/league-matchups.ts corrected, since it
     | claimed the Schedule page reads the column positionally when it reads
     | `metadata.starters` and the column is an unreachable legacy fallback.
     | verified: yes (tsc clean, next build clean, 135 files / 1980 tests)

T673 | completed | A bye week no longer renders as "Tied"
     | files: components/league-schedule/team-season.tsx
     | depends on: T636
     | `won` is false for three different things: a loss, a tie, and a roster with
     | no opponent. An odd-team league gives one manager a bye every week, and the
     | outcome ladder had no branch for it, so a week nobody played read "Tied".
     | The absence of an opponent is unambiguous in the data, so the fix is to ask
     | that question before the other two. The schedule agent found this, could
     | not fix it (the component was outside its file list) and reported it with
     | the exact branch needed rather than leaving it or reaching across.
     | verified: yes (tsc clean, 1980 tests green)

T674 | completed | Schedules rename, readable win probability, tighter sticky bar
     | files: app/leagues/[league_id]/schedules/** (renamed from schedule/),
     |        components/league-schedule/{win-prob-bar,schedule-controls,matchup-row,
     |        matchup-table,team-season,week-board}.tsx,
     |        components/league-shell/{nav-items,league-masthead,league-mobile-nav}.tsx,
     |        app/leagues/[league_id]/page.tsx, CLAUDE.md, docs/*.md
     | depends on: T638, T642, T672
     | Owner review pass. Seven changes, all cosmetic or navigational.
     |
     | 1. "Schedule" is "Schedules" everywhere: the route segment, the nav label,
     | the breadcrumb, the page title and heading, and the docs. No redirect is
     | needed because the old path was never committed.
     |
     | 2. Getting out of a matchup took a breadcrumb press. There is now a real
     | control row above the header: back to the week you came from, plus a jump
     | to either team's own season. Both carry the week and the roster so neither
     | lands on a default the reader has to correct.
     |
     | 3. The sticky control bar was three or four rows tall and pinned to the
     | viewport, so it spent that height on every screen of a long scroll. It is
     | one row now. Every label went sr-only, because the options already read
     | "Week 8 (this week)" and "Team name (6-2)" and a visible label above the
     | control was repeating what the control says. The end-of-season notes moved
     | inline in the same wrapping row, and the team filter went behind a toggle
     | button (the native select already has typeahead, so the filter is the
     | second way in rather than the only one). Below sm it wraps; nothing is
     | dropped at any width.
     |
     | 4. Projected points are now the largest thing in each player cell, pushed
     | to the INNER edge so both sides' numbers sit against the slot column. That
     | falls out of the flex direction for free: the home cell runs left to right
     | and the away cell is row-reverse, so appending the number puts it against
     | the middle on both sides. Two names and two scores now read as one
     | comparison down a single axis instead of four separate readings.
     |
     | 5. Win probability was unreadable and the reason is worth recording: a 6px
     | track split cyan and purple, two saturated brand colours of similar
     | lightness on a dark background, sit at nearly the same visual weight, so
     | an 80/20 split and a 60/40 split looked about the same. The reader was
     | doing arithmetic off the caption because the drawing told them nothing.
     | components/league-schedule/win-prob-bar.tsx makes the NUMBERS the headline
     | (large, tinted, above each team name), marks the favourite with a word so
     | it survives greyscale, doubles the track height with inline labels, and
     | draws a dashed centre line at 50 because a split reads far more precisely
     | against a fixed reference than in isolation. Used on the matchup header
     | and on every week card.
     |
     | 6. The team-season win probability column got the same treatment at row
     | scale: a large tinted percentage over a filled meter with the same dashed
     | centre mark, tinted by which side of even it falls on.
     |
     | 7. Nothing said the cards were clickable. The whole card was a link through
     | a stretched anchor on the heading, which works and is invisible. Each card
     | now carries a "View both starting lineups" line with a chevron that slides
     | on hover, the card border lifts to cyan on hover, the week panel helper
     | says it before the first card, and the team-season rows carry a "Lineups"
     | cue. All aria-hidden: the real link is the heading, and announcing a second
     | one would put two identical destinations in the reader's list.
     | verified: yes (tsc clean, next build clean, 135 files / 1980 tests green)

T675 | completed | A coloured state edge on every matchup, both schedule views
     | files: components/league-schedule/{format,matchup-row,week-board,
     |        team-season}.tsx
     | depends on: T674
     | A list of matchup cards on a dark surface ran together: every card was the
     | same background behind the same one pixel border, so the eye had to find
     | the gap rather than the edge. `stateEdgeClass` puts a 4px rule down the
     | left of each one and lets it carry the game's state: FF Beacon purple for
     | a game still to play, cyan for the live week, and a flat grey for a
     | finished one. Grey reads as settled precisely because it is the only one
     | of the three that is not a brand colour.
     | Applied to the week cards and to the week cell of each team-season row.
     | On the row it sits on the cell rather than the <tr>, because a border on a
     | table row is not painted under border-collapse in every engine. Card gap
     | went from 12px to 16px so the edges have room to read as separators.
     | ONE TRAP WORTH RECORDING: WeekBoard passed `isCurrent={false}` to every
     | card on purpose, so that during the live week six cards do not all glow
     | and cancel each other out. That would have meant the cyan edge never
     | appeared. `isCurrent` now always carries the true week state and drives the
     | edge, and a new `emphasise` prop controls the raised treatment separately.
     | It defaults to `isCurrent`, so a future list mixing weeks needs no extra
     | prop. Two decisions, two props.
     | Colour is reinforcement only: every card already carries a Final / This
     | week / Projected chip and every row already carries the outcome as a word.
     | verified: yes (tsc clean, next build clean, 1980 tests green)

T676 | completed | Home and away on every player, and a phone-first player cell
     | files: lib/sleeper.ts, lib/league-schedule/{types,matchup,data}.ts,
     |        components/league-schedule/{format,matchup-table,
     |        player-detail-dialog}.tsx
     | depends on: T639, T672
     | The lineup showed a player's opponent as a bare code, which says nothing
     | about whether it is a road game, and home and away is a real distinction to
     | a manager setting a lineup.
     | GETTING THE FACT, rather than inventing it. Neither `player_weekly_projections`
     | nor `player_stats` carries a venue marker: both give `opponent` as a bare
     | code. `game_id` looked promising and is not, it is an opaque number that
     | both sides of a game share. Sleeper's published season schedule does carry
     | `home` and `away`, keyed by the same `game_id`, so `getNflHomeAwayMap` in
     | lib/sleeper.ts reads it and returns a `${week}|${TEAM}` to boolean map.
     | Memoised for an hour and de-duplicated in flight, so it is one request per
     | process per season rather than one per matchup view. All Sleeper endpoints
     | live in lib/sleeper.ts, per CLAUDE.md.
     | THREE STATES, NOT TWO. `SchedulePlayer.nflIsHome` is nullable and the label
     | respects it: "(vs HOU)" at home, "(@ HOU)" away, "(HOU)" when the schedule
     | fetch did not answer. Defaulting a null to "vs" would print a home game for
     | every road game, which is exactly why the first version of this feature
     | printed no venue at all. The parentheses are load bearing too: the line now
     | reads "WR, BUF (@ HOU)" as one fact rather than running together.
     | MOBILE. The portrait moved above the name below sm, beside it from sm up.
     | At 360px the headshot, the name and the meta line were splitting about
     | 140px between them, so names truncated to a few characters and the meta
     | wrapped to three rows. Stacking the portrait returns the full cell width to
     | the text, which is what lets position, team and opponent sit on one line as
     | a single string rather than three spans in a wrapping row. The away side
     | stacks right-aligned and reverses at sm, so portraits stay on the outer
     | edges and the projected-points numbers stay on the inner edge against the
     | slot column.
     | verified: yes (tsc clean, next build clean, 1980 tests green)

T677 | completed | Contender / Bubble / Rebuilder, and Longshot in a redraft league
     | files: lib/league-team-status.ts, lib/league-team-status.test.ts,
     |   components/team-status-badge.tsx, components/league-key.tsx,
     |   lib/sleeper-to-format.ts, lib/league-power-pulse-data.ts,
     |   lib/league-team-status-data.ts, lib/trade-finder-data.ts,
     |   lib/trade-impact/types.ts, lib/trade-impact/evaluate.ts,
     |   lib/trade-impact/reasons.ts, app/tools/league-pulse/page.tsx,
     |   app/my-beacon/sleeper-leagues/page.tsx
     | Renames the three Power Pulse standing tags. Contender, Bubble, Rebuilder in
     | dynasty and keeper leagues; Contender, Bubble, Longshot in redraft, where
     | there is no next year to bank assets for and calling a team a rebuilder
     | claims something the league cannot support.
     | THE LOGIC IS UNTOUCHED. TeamStatusKey still drives every sort, filter and
     | trade-engine branch. A new `variant` on TeamStatus picks the words, and a
     | test asserts the classification is identical across both vocabularies.
     | KEEPER TAKES THE DYNASTY WORDS, via deriveKeeperStyle rather than
     | DerivedFormat.league_type. That one folds keeper into redraft because that
     | is how keeper leagues PRICE; what a manager can plan is a different
     | question. All 193 stored leagues carry settings.type, so it resolves for
     | every one (168 dynasty, 2 keeper, 22 redraft, 1 chopped).
     | LONGSHOT GETS DICE. The piggy bank is the one mark that cannot carry
     | across: banking assets is the whole idea in dynasty and an impossibility in
     | redraft. Swords and the splitting arrow are unchanged.
     | TWO COUPLINGS THE RENAME WOULD HAVE BROKEN QUIETLY. reasons.ts chose its
     | direction reason by matching "competitor" inside the DISPLAY label, so
     | Contender would have silenced direction-fit and direction-clash entirely;
     | TeamImpact now carries statusKey and the branch reads that. And five
     | surfaces put the label after an indefinite article, where "a Bubble" is not
     | a sentence, so TeamStatus carries a `phrase` form for prose while the badge
     | still renders `label`.
     | verified: yes (tsc clean, next build clean, 2018 tests green)

T678 | completed | Retune the calibration drift alert so it means something again
     | files: supabase/migrations/0206_calibration_drift_alerting.sql,
     |   lib/beacon/settings.ts, lib/beacon/reference.ts,
     |   lib/beacon/reference.test.ts, app/api/cron/beacon-reference-drift/route.ts,
     |   lib/email/beacon-reference-emails.ts, app/admin/beacon/calibration/page.tsx
     | depends on: T677
     | The drift check emailed on 13 of its first 24 nights and on 6 of the last 6.
     | An alarm that fires most days stops being read. Two causes, neither of them
     | the check itself.
     | THE THRESHOLDS WERE MEASURED ON THE WRONG BOARDS. Migration 0160 numbers
     | came with their evidence attached, and that evidence was dynasty boards in
     | the offseason. Dynasty still behaves exactly as predicted (mean move 20-32,
     | max 210, nobody over 250). Redraft does not and should not: two sources over
     | ~181 shared players, in August, on a board that reprices on every
     | depth-chart report (mean 34-94, max 736, 2.2-10.0 percent over 250). So
     | redraft gets its own four limits, keyed off format_configs.league_type
     | rather than a slug list, because the split is about how long a roster is
     | held and any future one-year board wants the same numbers. Dynasty rank
     | correlation moves 0.995 to 0.993, which it was tripping four times in 24
     | nights at 0.9942 while moving the average player 26 points: a limit sitting
     | inside its own noise.
     | THE TRIGGER WAS A SINGLE NIGHT. Widening far enough that one bad night never
     | fires would make the check useless, so the email now needs a streak
     | (calibration_drift_alert_streak, default 3). The metrics are still computed
     | and recorded EVERY night and the admin page still shows them on demand; only
     | the email waits. loadDriftAlertHistory reads the streak out of cron_runs
     | rather than a table of its own, because the drift job already records its
     | whole preview payload there.
     | REPLAYED AGAINST THE REAL 24 NIGHTS: 17 format-trips over 13 email nights
     | becomes 4 trips over 1 email night, and the 1 is the genuine three-night run
     | on redraft-ppr-sflex (8.7, 10.0, 9.4 percent of the board moving 250+).
     | verified: yes (tsc clean, next build clean, 2046 tests green; replay
     |   confirmed in SQL against cron_runs)

T679 | completed | See a cron that never fired, and put a lid on the ledger
     | files: lib/cron-health.ts, lib/cron-health.test.ts,
     |   app/api/cron/cron-health/route.ts, lib/email/cron-health-emails.ts,
     |   lib/cron-runs.ts, vercel.json
     | depends on: T678
     | On 2026-08-14 sync-dynastyprocess and recalculate-beacon did not run. There
     | is no row for either in cron_runs that day, while 07:00, 08:00 and 10:00 all
     | ran normally: the platform skipped the window. The consequence was a missing
     | day in the FF Beacon value series and a trends rebuild at 10:02 that ran
     | happily off a day-old board, and nobody was told.
     | NOBODY COULD HAVE BEEN. cron_runs records invocations that STARTED, so a job
     | that never fires writes no row, no error and no failed status, and the admin
     | health panel still shows its last success. The only way to see it is to
     | start from the list of jobs that should have run and look for the absence,
     | which is what findMissedJobs does, working off CRON_JOBS so a job added
     | there is covered without touching the new file.
     | PER-CADENCE WINDOWS. 26 hours for a daily job (Vercel promises the hour, not
     | the minute), 3 for anything hourly or faster. A month-restricted job is
     | checked in season and skipped out of it. A schedule with a restricted
     | day-of-month or day-of-week is skipped rather than guessed at: nothing uses
     | those today, and inventing an answer would make the first job that does
     | throw a false alarm.
     | THE LEDGER HAD NO LID. 135,591 rows and 67 MB, 99.7 percent of it from three
     | jobs running every minute or every five; the nightly jobs anyone reads were
     | 400 rows. Retention is per cadence: a week of the workers, a year of the
     | rest. Deletes go by primary key in bounded batches because PostgREST kills a
     | statement at 8 seconds and one predicate delete over six figures of rows is
     | one statement. Rows still marked 'running' are never pruned; a row with no
     | terminal status is the only evidence an invocation started and died.
     | ALSO FIXED cron_runs.error recording "[object Object]". errMsg did
     | String(err) on non-Errors, and Supabase throws PostgrestError, which is a
     | plain object, so the one genuine beacon-reference-rebuild failure in the
     | ledger lost its message, code, details and hint and can no longer be
     | diagnosed. Named fields are pulled out first now, with JSON as the fallback.
     | verified: yes (tsc clean, next build clean, 2046 tests green; checked
     |   against the live ledger, zero false misses at time of writing)

T680 | completed | Drop the pre-calibration value backup
     | files: supabase/migrations/0207_drop_pre_calibration_backup.sql,
     |   scripts/backfill-beacon-calibrated-history.ts, lib/database.types.ts
     | depends on: T679
     | Migration 0161 set one condition on its own removal: drop the table once the
     | rewritten series has been reviewed and trusted. It has been. Median FF
     | Beacon value on dynasty-ppr-sflex runs 163, 162, 164 into 2026-08-01 and
     | 163, 163, 162 out of it, with no step anywhere along a series that moves
     | smoothly from 144 in mid-June to 142 today. Twenty-three days of nightly
     | recomputes have since been written on top of the backfilled rows, and the
     | drift check has compared the board against a fresh candidate every one of
     | those nights.
     | No runtime code read it. 338,941 rows and 213 MB, about 12 percent of a
     | 1.8 GB value store, holding a snapshot of a scale the engine no longer uses.
     | Types regenerated via MCP after the drop; the only diff is the 33 lines for
     | the removed table.
     | verified: yes (tsc clean, next build clean, 2046 tests green; table
     |   confirmed gone, to_regclass returns null)

T681 | completed | A draft pick is season, round AND original owner
     | files: lib/trade-ideas/pick-label.ts, lib/trade-ideas/pick-label.test.ts,
     |   lib/trade-finder/types.ts, lib/trade-finder-data.ts,
     |   lib/trade-finder/_test-kit.ts, lib/trade-impact/types.ts,
     |   lib/trade-impact/proposal-url.ts, lib/trade-impact/proposal-url.test.ts,
     |   lib/trade-impact/evaluate.ts, lib/trade-impact/pick-identity.test.ts,
     |   lib/trade-impact/reasons.test.ts,
     |   app/leagues/[league_id]/trade-ideas/page.tsx
     | depends on: T680
     | Every layer keyed a pick on season and round. That is not an identity. One
     | roster in a real synced league holds NINE different 2027 1sts, from nine
     | different original owners, and across stored leagues 3,048
     | roster/season/round groups hold more than one pick, covering 7,274 picks.
     | Eight of those nine were unreachable: `picksByKey` kept whichever it wrote
     | last, the builder listed one, the URL could name one, and the one that
     | survived answered for all of them AT ITS OWN VALUE. The measured spread is
     | not cosmetic: in this league a 2027 1st ran 5,873 early against 4,242 late.
     | ORIGINAL OWNER IS NOW PART OF THE KEY, end to end. FinderPick carries
     | originalRosterId, isOwnPick, the handle, the team name and whether the
     | early/mid/late bucket was projected or read off a published draft order.
     | The URL token grows a fourth part (season-round-slot-originalRoster) and
     | three-part tokens still decode, because every link anyone has saved is one.
     | A malformed fourth part fails the token rather than falling back, since
     | falling back would resolve a shared link to a DIFFERENT pick and present it
     | as the one that was sent.
     | THE OWNERSHIP CHECK MATCHES ALL THREE. evaluate.ts rejects a pick that
     | roster does not hold rather than substituting a same-round pick it does.
     | The slot bucket is deliberately never matched on: it is our estimate and
     | Power Pulse can move it between loads, so requiring it to agree would
     | reject a real pick over a label we chose ourselves.
     | The pooling logic itself needed no change. lib/league-pick-position.ts
     | already resolved early/mid/late from the ORIGINAL owner's projected finish;
     | nothing downstream had been carrying the answer.
     | verified: yes (tsc clean, next build clean, 2073 tests green; confirmed in
     |   the browser against Men in Black MaxPF roster 8, which now lists nine
     |   separate 2027 R1s at three distinct prices)

T682 | completed | Pick a player off a list instead of out of a dropdown
     | files: components/trade-ideas/trade-builder.tsx,
     |   components/trade-ideas/pick-tag.tsx,
     |   components/trade-ideas/trade-verdict.tsx
     | depends on: T681
     | The picker was a dialog holding one select and one confirm button, so a
     | three-for-one offer cost three trips through open, filter, choose, confirm,
     | close. The list is the interaction now: the shared SidePanel drawer comes
     | in from the right on desktop and up from the bottom on a phone, every row
     | carries its own Add button, adding does not close anything, and a row
     | leaves the list once it is in the deal so what remains is always what is
     | still available.
     | WHICH ROSTER IT SHOWS is settled before the panel opens. The counterparty
     | is chosen first, so each side's panel lists exactly that team's assets and
     | can never offer something the server would reject.
     | A PICK READS AS ITS THREE FACTS, through one formatter
     | (lib/trade-ideas/pick-label.ts) used by the picker row, the row in a built
     | side, and the verdict, so the same pick cannot be named three ways.
     | "2027 R1", the pool as a coloured pill, then "(via @handle)" in subtle
     | text. The holder is deliberately absent: the side of the trade already
     | says it. Colour is never the only signal, the pill says its own word, and
     | the whole thing carries ONE aria-label ("2027 first round pick, projected
     | early in the round, via @handle") rather than three fragments and an "R1"
     | read as a letter and a number.
     | Players sort by value descending, because a package is assembled from the
     | top of a roster down and alphabetical buried the best player mid-list.
     | Picks sort by season then round. The filter appears past the existing
     | FILTER_THRESHOLD of 8 rather than always.
     | ALSO FIXED, both found while testing this: the counterparty select printed
     | the handle twice ("Sir Chuddy kid Cudi (@jnesselhauf) (jnesselhauf)")
     | because teamName is already formatTeamLabel output, and the button read
     | "Add pick" against a panel titled "Add a draft pick".
     | The local SidePanel was renamed DealSide; the file now imports the shared
     | drawer of that name.
     | verified: yes (tsc clean, next build clean, 2073 tests green; walked the
     |   drawer in the browser on both sides, adding, filtering and removing)

T683 | completed | An added row stays put, lights up, and offers Remove
     | files: components/trade-ideas/trade-builder.tsx, components/side-panel.tsx
     | depends on: T682
     | A row left the picker the moment it was added, which read as the row being
     | deleted rather than moved: the thing you just pressed vanished from under
     | the cursor, everything below it jumped up, and pressing the wrong name
     | meant closing the drawer to undo it. A row now stays exactly where it was,
     | takes a cyan border and wash, and its button becomes Remove. Nothing moves,
     | the mistake is visible, and the fix is the button you just pressed.
     | THE STATE IS SAID THREE WAYS, so colour is never carrying it alone: the
     | card lights, the icon turns from a plus to a check, and the word changes.
     | The button's accessible name changes with it, from "Add X to what you send"
     | to "Remove X from what you send", which says the state and the next action
     | in one breath. Deliberately not aria-pressed: a toggle announces "pressed"
     | and leaves the reader to work out what pressed means.
     | THE LIST DOES NOT RE-SORT when a row is pressed. Moving a row the instant
     | it is touched is the behaviour this change exists to remove.
     | REMOVE KEEPS WORKING AT THE CAP. Add goes dead at six assets a side; Remove
     | must not, because removing is how you get back under the cap without
     | leaving the drawer. The disabled Add explains that in its own label.
     | TWO KEYS PER ROW, NOT ONE. A picker row is keyed by the pick's real
     | identity, but an asset that arrived in a link written before the original
     | owner was encoded is stored under a vaguer key ("k:2027-1-any"). addedOnSide
     | resolves each stored asset back to the pick it points at and maps that to
     | the STORED key, so such a row both shows as added and can be removed again.
     | ALSO FIXED, in components/side-panel.tsx: `onClose` sat in the focus
     | effect's dep array, so any parent re-render with a fresh handler identity
     | tore the effect down, and its cleanup calls previouslyFocused.focus() while
     | the panel is still open. Focus would land behind the drawer and then be
     | dragged back inside 80ms later. Survivable while every caller memoized and
     | the contents were static; this picker is neither, since pressing a row is
     | now what re-renders it. Held in a ref, the same fix and the same reasoning
     | as components/slide-up-dialog.tsx, which had already been bitten by it.
     | verified: yes (tsc clean, next build clean, 2073 tests green; no browser
     |   pass this round, per instruction)

T684 | completed | Lead with the answer, then show the working
     | files: lib/trade-impact/outcome.ts, lib/trade-impact/outcome.test.ts,
     |   lib/trade-impact/asset-notes.ts,
     |   components/trade-ideas/trade-outcome.tsx,
     |   components/trade-ideas/trade-verdict.tsx,
     |   lib/trade-impact/types.ts, lib/trade-impact/evaluate.ts
     | depends on: T683
     | The evaluation opened on its reasons. Every one of them is true and none of
     | them is what a reader came for, which is "should I take this". They read
     | four paragraphs, two tables and a week-by-week chart and did the
     | subtraction themselves. There was no equivalent of Signal Check's "who
     | wins and by how much" anywhere on the page.
     | THE CALL IS A FUNCTION, NOT AN OPINION. lib/trade-impact/outcome.ts turns
     | figures the model already produced into one of five calls (take, lean yes,
     | too close, lean against, decline) by rules written out in the open, and
     | `summary` names the measure that decided so the call can be argued with. No
     | language model, per the ABSOLUTE RULE in CLAUDE.md; every sentence cites a
     | number printed on the same screen.
     | VALUE AND WINS ARE BOTH REPORTED, ALWAYS, because they routinely disagree
     | and the disagreement is the point of the module. When they split, the call
     | leans on whichever matches the team's own direction, the same rule
     | directionReason already uses: a contender is judged on the lineup and a
     | rebuilder on the value. A team in the middle gets NO tiebreak, because the
     | status classifier declined to say which way it points and inventing one
     | here would be a claim the rest of the page does not make.
     | THE MARGIN IS SIGNAL CHECK'S, |A-B| / (A+B), so the same trade cannot read
     | 12 percent on one tool and 30 on the other. A test pins it to Signal
     | Check's own fixture.
     | HALF THE EVIDENCE EARNS HALF THE VERDICT. With no season left to simulate,
     | value alone can reach "lean yes" and never "take".
     | THE ASSETS CARRY THE DEPTH. 64px photos, and per-asset notes from
     | lib/trade-impact/asset-notes.ts saying what each piece does for THIS
     | roster: how many weeks an arriving player cracks the optimal lineup
     | (incomingStartWeeks, the most useful thing the model knows about him), what
     | his position gains or loses, whether he is the piece the deal is about or a
     | throw-in, age where age is a currency.
     | A POSITIONAL NOTE IS ONLY PINNED ON AN ASSET WHEN IT IS THE SOLE PIECE AT
     | THAT POSITION in the whole trade. Two receivers crossing net out to one
     | number and hanging it on either would credit him with the other's effect.
     | That note is also the only thing that answers "good or bad for me" about a
     | player on the way OUT, where there are no start counts to read: the model
     | measures the lineup with him gone, not the weeks he used to fill.
     | Found in the browser and fixed: a 44 percent tight end, the main piece of a
     | three-for-one, was reading as an ordinary throw-in with no notes at all.
     | Centrepiece is now "biggest thing on its side AND at least 40 percent",
     | because a share alone gets both ends wrong (0.6 misses the main piece of a
     | three-for-one; 0.4 alone crowns both halves of a 55/45 pair).
     | Colour is never the answer on its own: the call is a word before it is a
     | colour, every tone chip carries its own label, and the balance bar is
     | aria-hidden with a sentence stating the same split, the pattern
     | app/tools/signal-check/trade-margin-graph.tsx set.
     | The panel sits ABOVE the tabs and outside them, because the call is true of
     | the whole evaluation and a reader who lands on the Value tab must not miss
     | it. That demotes the reasons panel from conclusion to evidence, which is
     | what it always was.
     | verified: yes (tsc clean, next build clean, 2093 tests green, 20 of them
     |   new on the call; walked a real 2-for-3 in the browser on Men in Black
     |   MaxPF, which reads "Lean against it, 1% value spread, -0.4 projected
     |   wins", with QB gaining 14.6 a week and TE losing 13.9)

T685 | completed | A ranking row says when it was last ranked, not when it was born
     | files: lib/seed-rankings.ts, lib/seed-rankings.test.ts
     | depends on: none
     | rankings.generated_at has a now() default, and a default fires only on
     | INSERT. The upsert conflicts on (player_id, format_config_id, source,
     | week, season), so every night after the first one UPDATES an existing row
     | and the default never fires again. The column recorded when a player was
     | FIRST ever ranked. Every reader assumes the opposite.
     | Three features filter on it as a 90-day relevance window:
     | lib/player-search.ts (all six search boxes), lib/signal-scout/
     | eligibility.ts (the daily game's player pool) and lib/beacon-brief-feed.ts.
     | So ranked players aged out of search, the game and the feed while being
     | ranked every single night, and nothing errored.
     | Measured against prod on 2026-08-25 before the fix: the job had just
     | written 11,458 rows and NONE of them carried that day's date. 2 players
     | were already invisible; 158 would go by 30 Sep, 712 by 31 Oct, and all
     | 815 by 30 Nov. Search would have gone dark mid-season.
     | Fix is one explicit generated_at on the row builder, stamped once per run
     | so a single snapshot cannot be split by a window boundary.
     | Ran npm run seed:rankings after the change: 11,458 of 12,115 rows now
     | carry today's date (the other 657 are combos no longer seeded and
     | correctly age out). Projected invisible-in-90-days fell from 815 to 15,
     | and those 15 are players genuinely no longer ranked by any source.
     | verified: yes (tsc clean, 3 new tests, one of which asserts the stamp is
     |   present and inside the run window; re-ran the real job against prod)

T686 | completed | A value from a source that stopped covering the player is not a current value
     | files: lib/calculate-trends.ts, lib/calculate-trends-staleness.test.ts
     | depends on: none
     | player_value_trends.current_value was "the newest snapshot we hold", with
     | no limit on how old that is allowed to be. A source that stops covering a
     | player keeps its last snapshot in player_value_history forever, so the
     | trade analyzer kept serving it as the player's CURRENT value.
     | Worse, it looked healthy from the outside: the trend row's own updated_at
     | said today, because the calc ran today. A table-level freshness check
     | (lib/data-freshness.ts, added T-1 session) reports this table green while
     | every one of these rows is wrong. Per-row staleness is a different
     | question from per-table staleness and needs its own answer.
     | Measured on prod 2026-08-25 before the fix: 213 players, 589 rows, worst
     | case 200 days old.
     | The gate already existed. lib/beacon/freshness.ts applies exactly this to
     | the FF Beacon blend, and its header describes this bug word for word. It
     | was simply never wired into the trends calc. Reused rather than rewritten:
     | staleDaysFor + FALLBACK_STALE_DAYS, so daily sources get 3 days and weekly
     | ones get 10 and DynastyProcess is not punished for publishing weekly.
     | No row is written rather than a null value, because current_value is NOT
     | NULL and the honest answer is that we have no current value for that pair.
     | A sweep then deletes rows the run did not write, matched on updated_at
     | rather than a key list, guarded on having written something so a load
     | failure cannot empty the table.
     | Ran npm run calculate:trends after the change: 11,497 rows written, 778
     | stale rows removed, 0 stale pairs remaining. Spot-checked Tahj Washington,
     | who was carrying a KTC value of 8635 last published on 9 June and now
     | reads 1308 from the format KTC still covers.
     | verified: yes (tsc clean, 2158 tests green, 9 new on the gate including
     |   the weekly-publisher exception; re-ran the real job against prod)

T687 | completed | Everything derived from stats rebuilds when the stats do
     | files: app/api/cron/sync-sleeper-stats/route.ts, lib/cron-runs.ts,
     |   lib/derived-tables-scheduled.test.ts
     | depends on: none
     | calculate-defense-splits and calculate-projection-accuracy existed only as
     | npm scripts. A search of every cron route found zero references to either.
     | They had last run by hand on 2026-08-01.
     | CORRECTION TO THE AUDIT THAT FOUND THIS. The audit reported them as "24
     | days stale, no 2026 rows". The owner pushed back and was right. Both filter
     | season_type 'regular' and the 2026 regular season has not started: Sleeper
     | read season_type "pre", week 3 on 2026-08-25, and player_stats held only
     | 2026 preseason weeks 1 and 2. Having no 2026 row was CORRECT. Re-running
     | both by hand after this change confirmed it: defense splits still produced
     | seasons 2025/2024/2023 only, and projection accuracy still produced 2025,
     | 2024 and all-time. Nothing was wrong with the data.
     | What was real, and all this task claims: neither would EVER have rebuilt.
     | Both pick their seasons from the data (recentSeasons() and max(season)),
     | so both take up 2026 by themselves the first time anything runs them, and
     | nothing would have. Strength of schedule would have stayed frozen on prior
     | seasons for the whole year, and player_projection_accuracy would never
     | have learned anything about the current one, which makes the CLAUDE.md
     | product requirement that the current season MUST outweigh prior seasons
     | unmeetable by construction. The failure was dated, not present, and it
     | lands the week the season does.
     | Chained both into the stats cron, which already chained positional
     | finishes and is the one moment their only input changes. Each derived calc
     | runs on its own error boundary: the stats are the irreplaceable part and a
     | derived table rebuilds next run.
     | Also added lib/derived-tables-scheduled.test.ts, which works backwards
     | from the producers the way lib/cron-health.ts works backwards from the
     | schedule. It fails if any lib/calculate-*, lib/sync-* or seed-rankings is
     | not imported by a cron route and not listed in ON_DEMAND_BY_DESIGN with a
     | reason. This test would have caught the sync-sleeper-players bug that
     | started this whole session, and it caught a second thing while being
     | written: app/api/cron/beacon-brief records itself as "beacon-brief-curate",
     | so the assertion reads the name out of recordCronRun rather than assuming
     | the folder.
     | verified: yes (tsc clean, 2175 tests green, 17 new; ran both calcs against
     |   prod, 1728 and 5637 rows, and confirmed the season coverage is right)

T688 | completed | One Sleeper state stops meaning two different things
     | files: lib/sync-sleeper-players.ts, lib/sync-sleeper-players.test.ts
     | depends on: none
     | deriveStatus() read Sleeper's `active` boolean FIRST and returned early,
     | which threw away the far more specific `status` string whenever the two
     | disagreed. One Sleeper state then mapped to two different values decided
     | by an unrelated flag: on prod, 53 players reading "Injured Reserve" came
     | out "inactive" while 39 with the identical string came out "ir". Most of
     | the specific branches the function exists to produce (ir, pup,
     | practice_squad, suspended, nfi) almost never fired. That is the root
     | cause of the search bug this session already shipped, and of T689.
     | Neither field is trustworthy alone, which is why the order matters rather
     | than one of them simply winning. The string says WHAT the situation is and
     | goes stale for departed players (Eli Manning still reads "Active"). The
     | boolean says WHETHER the player is in the league and knows nothing about
     | why. So a NAMED situation in the string wins, and the boolean is consulted
     | only when the string names nothing specific, which is exactly the Eli
     | Manning case.
     | Re-ran npm run sync:players. For every player the sync maintains the
     | mapping is now one to one: all 102 "Injured Reserve" read "ir", Practice
     | Squad reads practice_squad, and the 7 remaining "Active" -> "inactive" are
     | the correct Eli Manning shape (stale string, active=false).
     | The 53 rows still reading "Injured Reserve" -> "inactive" are NOT this
     | bug: they are Greg Olsen, Jordy Nelson, Sebastian Janikowski and other
     | long-retired players with active=false and no team, whom the inclusion
     | filter deliberately skips. Their rows are frozen at the 2026-05-16 seed
     | and "inactive" is an accurate description of them.
     | The doc comment now states plainly that this column is a description and
     | never a relevance test, so the next reader does not filter on it.
     | verified: yes (tsc clean, 20 new tests, one asserting both roster-flag
     |   variants of Injured Reserve agree; re-ran the real sync against prod)

T689 | completed | Beacon Brief links the player the article is about, whoever he is
     | files: lib/beacon-brief/match.ts, lib/beacon-brief/match-players.test.ts
     | depends on: T688
     | isCurrent() gated auto-linking on players.status being "active" or "ir".
     | It half-anticipated injuries and still got them wrong, because Sleeper
     | reports a player on injured reserve as "Inactive", not "Injured Reserve"
     | (T688 is why). So an article about a season-ending injury could not link
     | to the player whose injury it was, and the reason it went to manual review
     | was the injury itself.
     | OWNER'S INSTRUCTION, and it is broader than the audit proposed. The audit
     | wanted to swap the status test for a rankings-membership test. The
     | instruction is that this search must not be limited in ANY way: linking an
     | article to a retired player, or anyone else, has to be possible. So the
     | gate is REMOVED rather than replaced. News is written about whoever it is
     | written about, and the matcher's job is to identify the person named, not
     | to judge whether that person still matters.
     | Nothing about link safety is lost, because the status check never provided
     | any. What prevents a wrong link is the exact normalized-name match plus
     | the one-result rule, and both are unchanged and now covered by tests that
     | assert a merely-similar name still refuses and two same-named players
     | still go to moderation.
     | status is still read in ONE place, playerLabel(), purely so a human
     | choosing between two same-named players sees "[retired]" next to one of
     | them. Renamed the helper isUnremarkableStatus so nobody mistakes it for a
     | gate again, and renamed exactCurrent to exactMatches.
     | Checked the other two Brief player lookups and both were already
     | unfiltered: searchPlayers in app/admin/beacon-brief/actions.ts is a plain
     | ilike, and match-resolution.ts only checks the row exists. The RPC
     | bb_player_match_candidates does not filter either; it only uses
     | (status = 'active') desc as a tie-break among equally similar names, which
     | is an ordering preference and not a limit, so it stays.
     | verified: yes (tsc clean, 2208 tests green, 13 new including one asserting
     |   every status value links, retired included)

T690 | completed | The rankings season is derived, and the table holds exactly one
     | files: lib/seed-rankings.ts, components/rankings/rankings-view.tsx,
     |   app/api/rankings/import/route.ts, lib/seed-rankings.test.ts
     | depends on: T685
     | `const SEASON = 2025` was written out by hand in three files: the writer
     | and two readers. On 2026-08-25 all three still said 2025 while the site
     | was operating in the 2026 season. It worked only because they agreed on
     | the same wrong number.
     | The trap was that they could stop agreeing. Bumping the writer and missing
     | a reader leaves that reader querying a season nothing writes any more, and
     | it serves the frozen old rows forever without erroring. Same silent shape
     | as everything else in this batch.
     | Writer now derives from currentNflSeason(), which already existed in
     | lib/sleeper.ts and already handles the March rollover.
     | Readers do NOT get the derived constant, they drop the season filter
     | entirely, because a pinned constant on the reader has a second failure
     | mode: currentNflSeason() flips in March and the board would be blank from
     | midnight until that night's write. A sweep at the end of the writer
     | deletes every row from another season, so the table holds exactly one by
     | construction and no reader has to know which.
     | Ran npm run seed:rankings: 12,115 rows from season 2025 removed, 11,458
     | written under 2026, 800 players. The 15 players lost against yesterday's
     | 815 are the ones no source ranks any more, matching the T685 projection.
     | verified: yes (tsc clean, next build clean, 2211 tests green, 3 new
     |   asserting the derivation, the stamp and the sweep filter)

T691 | completed | A shareable card names the injury, not the roster paperwork
     | files: app/api/og/player/[slug]/route.tsx
     | depends on: T688
     | The card's meta line read players.status whenever it was not "active", so
     | Ricky Pearsall's shareable social card said "WR,  SF,  INACTIVE".
     | "Inactive" is Sleeper roster jargon nobody uses in fantasy, and it buries
     | the one fact a reader wants while the term they expect was sitting unused
     | in the same row. Now reads metadata.sleeper.injury_status, so the card
     | says IR, PUP or QUESTIONABLE, and a healthy player has no designation at
     | all so the line stays a clean "WR,  SF".
     | Checked against real rows: Pearsall IR, Charbonnet PUP, Nabers and Mahomes
     | Questionable.
     | This also removes the last user-facing consumer of players.status outside
     | the moderation label in lib/beacon-brief/match.ts, which is where T689
     | left it deliberately.
     | verified: yes (tsc clean, next build clean, 2211 tests green)

---

# League Pulse: Positional WAR

Plan: `docs/league-pulse-positional-war-plan.md` (written 2026-08-26 against `c068818`).
Task ids are the plan's own `T-WAR-##`. Started 2026-08-26.

Task format for this feature:

```
T-WAR-## | status | description
     | files: ...
     | depends on: T-WAR-##
     | verified: yes/no
```

## Wave 0 - Schema

T-WAR-01 | completed | Migration 0211: league_positional_war_cache + RLS + access matrix comment
     | files: supabase/migrations/0211_league_positional_war_cache.sql
     | depends on: none
     | notes: one row per (league, season, position). fingerprint, curve jsonb,
     |   weekly_diagnostics jsonb, structural_demand, war_rank_1, war_at_demand,
     |   cliff_rank, shallow_pool. Index on (league_id, season) matching 0165.
     |   Migration comment states the table is independent of value source and of
     |   format_config_id, the way 0165 does.
     | verified: yes (pg_policies shows exactly league_positional_war_cache_select_public
     |   for SELECT to anon+authenticated and league_positional_war_cache_service_role_all
     |   for ALL to service_role; a service-role insert inside a transaction is visible
     |   to `set local role anon` (1 row); an anon insert raises 42501 new row violates
     |   row-level security policy)

T-WAR-02 | completed | Migration 0212: positional_war_status/detail/attempted_at/succeeded_at on leagues + check constraint
     | files: supabase/migrations/0212_leagues_positional_war_status.sql
     | depends on: none
     | notes: five values pending/ok/skipped/settled/error, guarded by
     |   leagues_positional_war_status_check added inside a do-block so re-running is
     |   a no-op. Column comments record the write ordering rule: attempted_at before
     |   the expensive work, succeeded_at after the rows land.
     | verified: yes (information_schema shows all four columns; constraint present)

T-WAR-39 | completed | E4: migration 0214 positional_war_curves, service-role-only RLS, access matrix comment
     | files: supabase/migrations/0214_positional_war_curves.sql
     | depends on: T-WAR-01
     | notes: primary key (fingerprint, position), inputs_digest jsonb collision guard,
     |   first_league_id diagnostics only, idx on computed_at for the seven-day prune.
     | verified: yes (only positional_war_curves_service_role_all exists; a row inserted
     |   as service role inside a transaction is invisible to `set local role anon`)

T-WAR-49 | completed | E8: migration 0215 power_pulse_status/detail/attempted_at/succeeded_at on leagues
     | files: supabase/migrations/0215_leagues_power_pulse_status.sql
     | depends on: none
     | notes: mirrors 0212 exactly so the admin health view can list both features
     |   side by side with one row per league and a column per feature.
     | verified: yes (information_schema shows all four columns; constraint present)

T-WAR-03 | completed | Regenerate lib/database.types.ts via MCP after 0211, 0212, 0214, 0215
T-WAR-40 | completed | (same regeneration covers 0214)
     | files: lib/database.types.ts
     | depends on: T-WAR-01, T-WAR-02, T-WAR-39, T-WAR-49
     | notes: MCP output is JSON-wrapped, so the `.types` field was extracted before
     |   writing, then prettier-formatted. All four new surfaces present.
     | verified: yes (npm run typecheck clean; grep confirms league_positional_war_cache,
     |   positional_war_curves, positional_war_status and power_pulse_status all present)

## Wave 1 - Pure model

T-WAR-05 | completed | lib/positional-war/types.ts: WarCurvePoint, PositionCurve, WarInput, WeeklyDiagnostic
     | files: lib/positional-war/types.ts
     | depends on: none
     | notes: header states the naming rule (the token WAR names exactly one metric,
     |   the player-independent positional one, and carries "Positional" adjacent on
     |   first use). sleeperId carried on every curve entry so the team overlay and the
     |   Trade Ideas note can join against rosters.player_ids without a second query.
     |   warAtDemand documented as deliberately non-zero.
     | verified: yes (tsc clean)

T-WAR-06 | completed | lib/positional-war/default-settings.ts: displayDepthMultiple, minDisplayDepth, cliffThreshold, clampBelowReplacement, modelVersion, TTL and retry constants
     | files: lib/positional-war/default-settings.ts
     | depends on: T-WAR-05
     | notes: POSITIONAL_WAR_TTL_MS 12h matching POWER_PULSE_TTL_MS, POSITIONAL_WAR_RETRY_MS
     |   15 min. One backoff constant with explicit bypasses rather than a second longer
     |   constant, because what makes a retry worthwhile is a change in the inputs.
     | verified: yes (tsc clean)

T-WAR-10 | completed | lib/positional-war/war.ts: PAR, baseline/evaluated means, weekly and season WAR
T-WAR-11 | completed | Worked-example fixture + anti-double-count regression guard
     | files: lib/positional-war/war.ts, lib/positional-war/war.test.ts
     | depends on: T-WAR-05
     | notes: the two lineups are written out in the module header, along with why
     |   subtracting avgSeated is the anti-double-count and what the double count costs
     |   (0.5% at realistic magnitudes, 16% in a low-variance league). The sigma
     |   simplification is stated as deliberate. Degenerate zero-spread branch mirrors
     |   winProbability(). Non-finite input returns 0 rather than NaN.
     | note on the plan: the plan's worked example prints 0.08395 and 0.08351, both
     |   carrying intermediate rounding (sigmaD 37.94 rather than 37.94733, and a z of
     |   0.21086 rather than 0.2108189). The exact figures are 0.0839418 and 0.0834855.
     |   The test asserts the plan's own 1e-5 bound on the first and pins the GAP
     |   (0.54%) on the second, since the gap is what the fixture is really for.
     |   vitest toBeCloseTo(x, 5) is a 5e-6 tolerance, tighter than the plan's 1e-5,
     |   so the bound is written out explicitly.
     | verified: yes (19 tests green, tsc clean; PAR=0 gives exactly 0 across every
     |   deficit 0 to 30; 500 random triples confirm evaluatedMean - baselineMean = PAR;
     |   200 perturbations confirm strict monotonicity in PAR; season = sum of weekly
     |   within 1e-9; two runs byte-identical)

T-WAR-04 | completed | Export isNonScoringKey from lib/league-scoring.ts + test that normalizedScoring matches scoreStatMap's key set
     | files: lib/league-scoring.ts, lib/league-scoring.test.ts
     | depends on: none
     | notes: exported with a comment saying the fingerprint derives its normalized
     |   scoring map from exactly the key set scoreStatMap iterates, so the two must
     |   change together.
     | verified: yes (28 tests in league-scoring.test.ts, 16 new, all green)

T-WAR-07 | completed | lib/positional-war/fingerprint.ts: normalizedScoring + warFingerprint + warInputsDigest + digestsMatch
     | files: lib/positional-war/fingerprint.ts, lib/positional-war/fingerprint.test.ts
     | depends on: T-WAR-04, T-WAR-06
     | notes: sha256 over a recursively key-sorted canonical JSON, so the digest cannot
     |   depend on object iteration order. No clock, no RNG, no I/O: projectionsSnapshot
     |   arrives already truncated to the hour from the caller. pulseSettings is a Pick of
     |   only reliability/availability/injury/opponent/variance/recency, so an admin edit
     |   to weights, simulation, display or the Power Pulse modelVersion does NOT
     |   invalidate a curve. Slots are sorted, because the merged fill's seated SET is
     |   invariant under slot permutation.
     | agent decision beyond the plan: the absence of a value source from the fingerprint
     |   is enforced as a COMPILE-TIME conditional type assertion rather than only a
     |   comment, so a future accidental `source` field fails tsc.
     | verified: yes (32 tests green, covering every row of the plan's section 6.4 false-hit
     |   table including the two intentionally-not-caught rows asserting equality, plus
     |   nine independent digest-field rejections; tsc clean; full suite 2268 tests green)

T-WAR-32 | completed | E1a: extract matchViewerRoster into lib/league-viewer.ts, make team-filter.tsx import it
     | files: lib/league-viewer.ts, lib/league-viewer.test.ts, components/team-filter.tsx
     | depends on: none
     | notes: extracted verbatim from the private resolveOwnerRosterId. The rule is
     |   unchanged: explicit ?roster= wins when it matches a team, then a
     |   case-insensitive trimmed match of ?username= against the owner's Sleeper
     |   username, else null. TeamCardData satisfies ViewerCandidate structurally so the
     |   client call site did not change.
     | verified: yes (6 tests green, including a guard that reads team-filter.tsx and
     |   asserts it imports matchViewerRoster and defines no local copy, which is what
     |   stops the second implementation coming back)

T-WAR-46 | completed | E1b: lib/positional-war/rate-limit.ts, WAR_UPGRADE bucket at 5/min
     | files: lib/positional-war/rate-limit.ts
     | depends on: none
     | notes: its own bucket, not the trade bucket. The one-bucket-for-three-paths
     |   reasoning in lib/trade-impact/rate-limit.ts is about three entry points into ONE
     |   evaluation; sharing across two features would mean using Trade Ideas exhausts
     |   this panel, a real cost with no security gain. lib/breakdown/league-mode.ts is
     |   the precedent. Five per minute because there is one press per answer.
     | verified: yes (tsc clean; fails closed through lib/rate-limit-claim.ts)

T-WAR-28 | completed | E7: war settings block + merge + zod bounds
     | files: lib/power-pulse/default-settings.ts, lib/power-pulse/validate.ts,
     |   lib/power-pulse/validate.test.ts
     | depends on: T-WAR-06
     | notes: war: WarSettings added to PowerPulseSettings and to the defaults, merged
     |   through the existing one-level obj() shallow merge in one line, so a stored
     |   document written before this ships degrades to the defaults rather than failing.
     |   Zod bounds are the plan's, with the reasoning inline.
     |   Checked the admin save path: app/admin/power-pulse/page.tsx loads through
     |   loadPowerPulseSettings (which now merges war in) and the manager POSTs the whole
     |   object, so a required war block is safe with the existing form.
     | verified: yes (validate.test.ts created, 8 tests; every bound rejects a value one
     |   step outside it; a document with no war key loads the defaults; a partial war
     |   object merges rather than dropping fields; full suite 2287 tests green)

T-WAR-17 | completed | Promote ChartFigure/DataTable to components/chart-kit.tsx, re-export from the breakdown path
     | files: components/chart-kit.tsx, app/tools/beacon-breakdown/chart-kit.tsx
     | depends on: none
     | notes: moved verbatim with the original header, which documents why the summary is
     |   a visually hidden paragraph rather than role="img". The old path is now a
     |   two-line re-export shim, so the four Beacon Breakdown tabs are untouched.
     | verified: yes (grep confirms all four importers still resolve; npm run build clean
     |   including /tools/beacon-breakdown)

T-WAR-18 | completed | Six-series palette + legend primitives (hue, dash, marker), dataviz skill loaded first
     | files: components/chart-kit.tsx, components/chart-kit-legend.tsx,
     |   components/chart-kit.test.ts, vitest.config.ts
     | depends on: T-WAR-17
     | notes: contrast computed against the ACTUAL composited panel surface (bg-surface/50
     |   over bg-base resolves to #0B0B14), not against a token name.
     |   QB #A855F7 solid circle 4.95:1 (AA, and AA-only because it is the fixed brand
     |   purple), RB #22D3EE dash 8 4 square 10.84:1, WR #FB923C dash 2 3 diamond 8.65:1,
     |   TE #60A5FA dash 6 2 2 2 triangle 7.70:1, K #FB7185 dash 1 4 cross 7.28:1,
     |   DEF #FDE047 dash 10 3 2 3 2 3 star 14.86:1. All six clear AA, five clear AAA.
     |   Exported as DATA, not Tailwind classes, because the OG route reads the same
     |   values server side through Satori and cannot resolve a class.
     |   SeriesToggleLegend lives in its own "use client" file so chart-kit.tsx stays
     |   server-renderable for its existing server-component callers.
     | dataviz skill finding, carried forward: WR and K sit at delta-E 12.5 for normal
     |   vision under the skill's informational all-pairs check (its prescribed mode for
     |   line charts is adjacent pairs, which passes with wide margin at 17.4 CVD / 26.9
     |   normal on the worst pair). Six WAR curves can cross, so any two can end up
     |   visually adjacent. Every reassignment tried broke a different pair. The
     |   mandatory per-series dash and marker are the sanctioned mitigation under the
     |   skill's own rule, and they were already required.
     | vitest.config.ts change: test.include did not cover components/, so the new test
     |   file was not being picked up. Widened.
     | verified: yes (8 tests green; full suite 2295 tests green; tsc and build clean)

T-WAR-23 | completed | Migration 0213: Signal Guide global term "Positional WAR"
     | files: supabase/migrations/0213_signal_guide_positional_war_term.sql
     | depends on: none (content only; the plan sequenced it after the panel, but it
     |   depends on nothing in code)
     | notes: display_order 13, directly after Power Pulse at 12, which is the term
     |   readers are most likely to confuse it with. Most of the entry is the difference
     |   between the two. Idempotent `where not exists` guard on (page_id, kind, heading),
     |   following 0167, so re-running never clobbers copy an admin has since edited.
     | verified: yes (row present, is_global true, is_published true, 2180 characters)

T-WAR-24 | in_progress | CLAUDE.md: the Positional WAR naming rule + the on-demand/no-cron/source-independent rules
     | files: CLAUDE.md, docs/data-sources.md
     | depends on: none
     | notes: CLAUDE.md done. Added the route to the League Pulse naming rules, a sync
     |   rule line, an observability paragraph to the Power Pulse section, and a full
     |   "Positional WAR (League Pulse positional scarcity)" section carrying the naming
     |   rule, the never-rerun-the-optimizer rule, the source and format independence
     |   rule, the on-demand/no-cron rule, the structural-versus-weekly specification,
     |   the module map, and the storage and observability notes. docs/data-sources.md
     |   still to check.

     | docs/data-sources.md done: a new "Surfaces that are deliberately
     |   source-independent" subsection under "Where source filtering is applied",
     |   naming Power Pulse and Positional WAR, stating neither carries a source column
     |   nor may gain one, and recording that the fingerprint's lack of a source field is
     |   a compile-time assertion rather than a comment.
T-WAR-24 | completed | (see notes above)
     | verified: yes (tsc clean)

T-WAR-42 | completed | E4: seven-day prune in the nightly recalculate-derived cron, one statement, no league iteration
     | files: app/api/cron/recalculate-derived/route.ts
     | depends on: T-WAR-39
     | notes: one delete against positional_war_curves where computed_at is older than
     |   seven days, sitting with the other global deletion-only prunes and non-fatal
     |   like them. Iterates no leagues, so the standing rule holds. The route's header
     |   comment now says the same about Power Pulse and Positional WAR that it already
     |   said about power rankings. Rows include the fingerprint in the returning select
     |   so the count is real rather than assumed.
     | verified: yes (tsc clean)

T-WAR-08 | completed | lib/positional-war/replacement.ts: merged fill, structural + weekly demand, replacement/avgSeated/deficit/muRef/sigmaRef
T-WAR-09 | completed | Flex configuration tests F1 through F9 + ordering invariants
     | files: lib/positional-war/replacement.ts, lib/positional-war/replacement.test.ts
     | depends on: T-WAR-05
     | notes: buildOptimalLineup is called ONCE per fill, and the module header states
     |   that the optimizer is never rerun per player and why the instinct to write that
     |   loop computes a different metric under the same name. Replacement is definition A
     |   (best benched player at the position), with the per-slot and refill alternatives
     |   rejected in the header for stated reasons. Shallow pool falls back to the minimum
     |   seated points, never zero.
     | fixture notes from the agent: F2 reuses the exact counterexample in lineup.ts's own
     |   header (20/15/12, greedy 32 against exact 35), so it is traceable. F7 needed two
     |   universes: a contiguous integer ladder converges identically regardless of flex
     |   depth, which is a real property of the ladder rather than of the model, so a
     |   second staggered universe was added to show the flex-depth effect.
     | verified: yes (28 tests green, every F block asserting the benched-never-beats-seated
     |   invariant, seated = exact top k, and exact teamCount * dedicatedSlotCount for
     |   non-flex positions)

T-WAR-34 | completed | E2: extract path maths into lib/positional-war/chart-geometry.ts (pure), both axis modes
     | files: lib/positional-war/chart-geometry.ts, lib/positional-war/chart-geometry.test.ts
     | depends on: T-WAR-05
     | notes: built BEFORE the chart component rather than extracted from it, so the
     |   component and the OG route are both callers from the start and cannot disagree
     |   about a league. Depth mode puts every marker at x = 1.0; rank mode fans them out
     |   at x = structuralDemand. yMin is computed from the data, not floored at zero, so
     |   clampBelowReplacement: false renders correctly (E7-4).
     | agent decisions beyond the plan: the shared 1.0 tick reads "Replacement level"
     |   because six positions have six different counts and one shared tick cannot carry
     |   them all (each series carries its own count in its marker label instead); a
     |   Heckbert nice-number y scale searching for a 4 to 6 tick count; and the marker
     |   borrows the last real curve point when a shallow pool stops short of demand,
     |   extending the plan's stated rule for the rank-cap case rather than inventing a
     |   value.
     | verified: yes (24 tests green, including a walker that asserts every number in the
     |   returned object is finite across every fixture)

T-WAR-12 | completed | lib/positional-war/engine.ts: pure computeCurves(), ranking, depth cap, cliff, diagnostics. No I/O
     | files: lib/positional-war/engine.ts, lib/positional-war/engine.test.ts
     | depends on: T-WAR-10
     | notes: W+1 fills, then arithmetic. Per-position weekly stats are computed once per
     |   week and reused by every player at that position, which is what keeps the cost
     |   O(W * V * E). Ranking is by WAR, ties by PAR, then by playerId ascending so the
     |   order is total and a recompute cannot reshuffle two identical players. A bye is
     |   absent from the sum and absent from the per-week mean, never a zero.
     |   Also exports unprojectableSlots(), which names an IDP league's excluded slot
     |   tokens for the footnote, derived from the league's RAW roster_positions so two
     |   leagues sharing a curve still get their own footnote.
     | verified: yes (31 tests green: every series monotonically non-increasing; seated
     |   totals equal slots times teams exactly; QB, K and DEF fixed at teamCount in a
     |   one-QB league; superflex raises rank-1 QB WAR by more than 40 percent and lowers
     |   QB replacement; replacement falls and rank-1 WAR rises monotonically at 10, 12
     |   and 14 teams; warAtDemand is positive for at least four of six positions; 33
     |   teams flags shallow_pool at DEF with a non-zero replacement; a heavy bye week
     |   lowers that week's replacement; two runs are byte-identical)

T-WAR-13 | completed | lib/positional-war/load.ts: cached full-universe projection read, keyed (season, fromWeek, toWeek, scoringBase)
     | files: lib/positional-war/load.ts, lib/positional-war/load.test.ts
     | depends on: T-WAR-05
     | notes: the universe read is identical for every league in the same season and week
     |   window, so it is memoized through unstable_cache with a cookie-less read client
     |   (every table it touches is RLS-public). scoringBase is in the key because
     |   loadAccuracy and loadDefenseSplits are keyed by it.
     |   THE MAP TRAP: unstable_cache serializes through JSON and a Map serializes to
     |   "{}". The cached function returns tuple arrays and loadWarUniverse rebuilds the
     |   three Maps on every call, hit or miss. Without that split, every cache hit would
     |   return three empty Maps and silently zero every projection for every league
     |   until the tag was busted. Both files carry the reasoning.
     |   Player resolution goes player-id-first with a plain .in("id", chunk), which is
     |   simpler and safer than the .or() external-id filter loadPlayers needs for the
     |   other direction. The count guard reads every row in the window rather than a
     |   distinct count, so a short read is caught before dedup hides it.
     |   buildWarPlayers computes reliability once per player, outside the week loop.
     |   A null projectPlayerWeek is a bye and the week is absent, never a zero.
     | verified: yes (9 tests green, including the JSON round trip that pins the Map fix,
     |   the count guard throwing on a short read, a spy confirming reliability is applied
     |   exactly once for a three-week player, and hour truncation on the snapshot)

T-WAR-29 | completed | E7: Positional WAR fieldset in the admin settings manager + server-side revalidation
     | files: lib/positional-war/default-settings.ts, lib/power-pulse/validate.ts,
     |   app/admin/power-pulse/power-pulse-settings-manager.tsx, lib/power-pulse/validate.test.ts
     | depends on: T-WAR-28
     | notes: rather than a test that watches for the form and the schema drifting apart,
     |   the bounds became ONE constant, WAR_SETTING_BOUNDS in
     |   lib/positional-war/default-settings.ts, that both the zod schema and the form's
     |   min/max/step read. The two cannot state different numbers. The test derives its
     |   one-step-outside values from the constant, so it breaks if a future edit stops
     |   reading it.
     |   The fieldset's helper text carries the sentence the plan insists on, because it
     |   is different from the Power Pulse block directly above it: saving recomputes
     |   nothing, and every field is part of the cache key, so each league recomputes on
     |   its next view on its own. An admin will otherwise assume they must bump the
     |   model version.
     |   aria-describedby was wired through the shared Field and NumberInput components,
     |   so every input in the form, old and new, now has a properly linked hint.
     |   clampBelowReplacement is a real checkbox with its consequence described.
     |   The server action already calls requireAdmin then validatePowerPulseSettings on
     |   the posted document, independent of the client, so no change was needed there.
     | verified: yes (typecheck, build, and 2426 tests green)

## E8 - Power Pulse observability parity

T-WAR-50 | completed | E8: classify the nine return shapes, write verdicts, add POWER_PULSE_RETRY_MS with the section 8.2 bypasses
     | files: lib/league-power-pulse.ts, lib/league-power-pulse.test.ts
     | depends on: T-WAR-49
     | notes: closes a real production defect. powerPulseIsStale returned true whenever
     |   there were no rows and calculateLeaguePowerPulse's skipped reason was only ever
     |   passed to console.warn, so a league that skipped deterministically re-attempted
     |   on every page view and the panel said "still calculating" forever with no way
     |   for anyone to learn why.
     |   The classifier is a lookup over the existing reason strings, matched by exact
     |   string or prefix because several carry a dynamic suffix. An unrecognised reason
     |   degrades to 'skipped', the sooner-retrying verdict, so a future added reason is
     |   retried rather than parked forever.
     |   Settled triple encoded as `<reason> [settled season=2026 week=9 playoffStart=15]`.
     |   attempted_at is written before calculateLeaguePowerPulse; status, detail and
     |   succeeded_at after the rows land.
     | agent judgment call against the plan: a settled verdict's triple comparison needs
     |   a live current NFL week, which this codebase only gets from getNflState(), a
     |   Sleeper call (process-wide memoised for 60s, not a per-league round trip). The
     |   plan says the settled backoff costs one small select and never more. The agent
     |   made getCurrentWeek a lazy closure that powerPulseIsStale invokes only on the
     |   settled branch, so a skipped or error backoff is genuinely zero-network, which
     |   is what E8-2 asserts. Documented in the code.
     | verified: yes (24 tests green: the nine-shape classification, the bypass table,
     |   write ordering asserted by call index, the early return, force bypassing, and an
     |   unrecognised reason classifying as skipped)

T-WAR-51 | completed | E8: status-aware Power Pulse empty states, deferring to PreDraftNotice where it already applies
     | files: app/leagues/[league_id]/power-pulse/page.tsx
     | depends on: T-WAR-50
     | notes: PowerPulseEmptyState, one fixed sentence per status. power_pulse_detail is
     |   never rendered verbatim to a non-admin reader. The PreDraftNotice branch is
     |   untouched, which is E8-5.
     | verified: yes (build clean, full suite green)

T-WAR-52 | completed | E8: /admin/system/league-health, both features side by side, counts by status, real landing page
T-WAR-26 | completed | (subsumed: the same view carries the positional_war_status='error' and stale-succeeded_at sections)
     | files: app/admin/system/league-health/page.tsx, app/admin/system/page.tsx
     | depends on: T-WAR-50
     | notes: app/admin/system/page.tsx was a bare redirect to webhooks with a comment
     |   saying webhooks was the only sub-area; it is now a real landing page listing
     |   both. The health view is gated by requireAdmin() at the page AND inherits the
     |   layout-level gate, matching the existing convention. One row per league with a
     |   column per feature. Leagues never viewed (all four columns null) are excluded,
     |   since that is not a fault. Fingerprint collisions surface as their own count.
     |   detail is rendered as text, never as HTML, and only to admins.
     | verified: yes (build clean; E8-6 gate confirmed against the pattern every other
     |   admin page uses)

## E3 - Positional WAR in Trade Ideas

T-WAR-36 | completed | E3: positionalWar field on AssetVerdict + deterministic template + optional map parameter
T-WAR-37 | completed | E3: cached() curve map load on the Trade Ideas page + separated card block
T-WAR-38 | completed | E3: naming guard revised to the proximity rule (done earlier, in lib/positional-war/naming.test.ts)
     | files: lib/trade-impact/asset-notes.ts, lib/trade-impact/asset-notes.test.ts,
     |   lib/trade-impact/positional-war-context.ts, components/trade-ideas/trade-outcome.tsx,
     |   components/trade-ideas/trade-verdict.tsx, components/trade-ideas/suggestion-evaluation.tsx,
     |   components/trade-finder.tsx, app/leagues/[league_id]/trade-ideas/page.tsx
     | depends on: T-WAR-14 (read only; it never triggers a computation)
     | notes: the three constraints hold. READ ONLY: the page reads
     |   league_positional_war_cache and never imports the writer, so a trade evaluation
     |   cannot become a compute trigger behind a metered endpoint's cheap path.
     |   LABELLED: the string is always "Positional WAR (league-wide)".
     |   SEPARATED: the block is a sibling of the notes list, never inside it.
     |   Template: `Positional WAR (league-wide): ${war.toFixed(2)}. ${position}${positionRank} of ${structuralDemand} who start in this league.`
     |   Deterministic, every figure present in the input, no thresholds and no adjectives.
     |   A pick, a player past the display cap, and a player with no Sleeper id all yield
     |   null, and the card renders exactly as it did before.
     |   The loader is its own module rather than an addition to load.ts, because load.ts
     |   is scoped to the heavy per-evaluation simulation input and this is a cheap
     |   page-level read. Wrapped in React cache() keyed on primitives, mirroring
     |   loadBuilderLeague, so the suggestion list and the builder verdict share one query.
     | KNOWN LIMITATION, flagged by the agent and worth a follow-up: no deep-link
     |   mechanism to a single Signal Guide term exists anywhere in this codebase, and
     |   /leagues/[id]/trade-ideas is not in the guide page registry at all. Wiring a true
     |   in-page opener needs a registry migration, which is outside this task and would
     |   have collided with the concurrent migration work. The card link goes to the
     |   League Overview instead, which IS a registered guide page and where the
     |   Positional WAR term already surfaces. Honest and functional, but it does not
     |   open in place.
     | verified: yes (23 tests in asset-notes.test.ts; the structural separation is a
     |   REAL assertion, not a JSX-shape approximation: the agent confirmed no
     |   component-rendering infra exists (vitest runs in node with no jsdom), used
     |   react-dom/server renderToStaticMarkup on TradeOutcomePanel, and wrote a
     |   balanced-tag range parser proving the Positional WAR block is never nested
     |   inside the wins-metric element or the reverse. 166 tests green across
     |   naming.test.ts and lib/trade-impact/)

## Wave 3 - Orchestrator

T-WAR-14 | completed | lib/league-positional-war.ts: orchestrator, fingerprint + TTL + week + version staleness, backoff, status writes, clear-on-settled, never throws
     | files: lib/league-positional-war.ts, lib/league-positional-war.test.ts
     | depends on: T-WAR-03, T-WAR-07, T-WAR-12, T-WAR-13
     | notes: staleness is fingerprint OR model version OR week window OR TTL, so a
     |   commissioner who turns on TE premium at 11pm sees a corrected curve on the next
     |   page view rather than up to twelve hours later.
     |   Backoff bypasses per plan 8.2: force, a fingerprint change, or last_pulsed_at
     |   advancing past the attempt for error and skipped; force or a changed
     |   (season, fromWeek, toWeek) for settled. The fingerprint check is deliberately
     |   cheap: it needs the league row, the settings, and the projections snapshot, and
     |   NOT the universe load, which stays behind it.
     |   attempted_at before the expensive work, succeeded_at and the rows after.
     |   Settled detail format `<reason> [settled season=2026 fromWeek=9 toWeek=8]`,
     |   matching Power Pulse's bracketed key=value style with this model's own fields,
     |   since it tracks a week window rather than a current week plus a playoff start.
     |   No draft-pending guard: the model reads no roster, so a pre-draft league still
     |   gets a full curve. That guard is correct for Power Pulse and wrong here.
     |   Team count is total_rosters, then the stored roster count, then a skip with
     |   "unknown team count". It never defaults to 12.
     | agent additions beyond the brief: `collision` and `fingerprint` on the result type,
     |   because the brief's shape had nowhere to carry "a collision happened, write this
     |   detail" or the fingerprint prefix for the log line without a second recompute.
     |   Both additive. Duration is measured in refreshPositionalWar and appended to the
     |   detail for ok verdicts only, leaving the result type duration-free.
     | verified: yes (28 tests: a throw sets error and leaves existing rows untouched and
     |   does not throw to the caller; a second call inside the retry window performs no
     |   loads, asserted by a spy on the universe loader; force and a fingerprint change
     |   each bypass; an empty window sets settled AND deletes rows; a transient skip does
     |   NOT delete rows; write ordering asserted by call index; total_rosters null falls
     |   back then skips; a pre-draft league still produces a curve)

T-WAR-41 | completed | E4: share-on-write path, inputs_digest collision guard, concurrent-upsert idempotence
     | files: lib/positional-war/share.ts, lib/positional-war/share.test.ts
     | depends on: T-WAR-40, T-WAR-14
     | notes: resolveSharedCurves implements hit, collision, and miss verbatim. On a hit
     |   the nine-field inputs_digest is recomputed from the requesting league and
     |   compared field by field; a mismatch logs both digests at error level, deletes the
     |   colliding rows, recomputes, and writes "fingerprint collision, recomputed" into
     |   the detail so it surfaces in the admin health view. That is what turns the silent
     |   failure mode into a loud one.
     |   No lock and no coalescing on concurrent upserts: the work is bounded and a lock
     |   is a new failure mode. `on conflict do update` makes the second write a harmless
     |   overwrite of identical data.
     |   The read path is unchanged: league_positional_war_cache keeps its full rows, so
     |   every consumer still issues exactly one query (E4-3).
     | verified: yes (6 tests covering hit, miss, collision, and concurrent idempotence)

T-WAR-15 | completed | Chain refreshPositionalWar into pulseLeagueDerived as a fourth parallel stage with its own timing label
     | files: lib/league-pulse.ts
     | depends on: T-WAR-14
     | notes: a fourth INDEPENDENT stage in the existing Promise.all, not sequenced after
     |   refreshPowerPulse. It reads no Power Pulse output and no roster, so there is no
     |   ordering constraint, and each stage already owns its own failure. Commented so
     |   nobody "fixes" it into a queue.
     | verified: yes (typecheck clean, full suite green)

T-WAR-16 | completed | scripts/calculate-positional-war.ts + npm run calculate:positional-war
     | files: scripts/calculate-positional-war.ts, package.json
     | depends on: T-WAR-14
     | notes: mirrors scripts/calculate-league-power-pulse.ts. All leagues by default,
     |   --sleeper-league-id <id> for one, --force to bypass every cache.
     | verified: yes (typecheck clean)

## Wave 4 - Reading surfaces

T-WAR-19 | completed | components/league-war/positional-war-chart.tsx: SVG, normalized axis, legend toggles, focus readout
T-WAR-20 | completed | components/league-war/positional-war-panel.tsx + lib/league-positional-war-data.ts
T-WAR-27 | completed | E6: rail summary card, scarcest and deepest, cache()-shared read, anchors to the chart panel
T-WAR-33 | completed | E1a: viewer roster join + ring markers + Yours column + per-position summary + past-the-cap line
T-WAR-35 | completed | E2: ?war=rank radiogroup toggle modelled on rank-mode-toggle.tsx, wired through the chart
     | files: lib/league-positional-war-data.ts, components/league-war/{selection,overlay,summary}.ts,
     |   components/league-war/{positional-war-chart,positional-war-panel,war-axis-toggle,war-rail-summary}.tsx,
     |   components/league-war/{rail-summary,overlay,summary}.test.ts, components/dashboard-panel.tsx
     | depends on: T-WAR-14, T-WAR-18, T-WAR-34
     | notes: the chart is built ON TOP of buildChartGeometry and owns no path maths, so
     |   the page and the shared card cannot disagree about a league.
     |   The svg is aria-hidden; every fact it carries is in the visually hidden summary,
     |   the legend text, or the always-present data table. Hiding a series through the
     |   legend removes it from the svg and leaves the table complete.
     |   The readout is a FOCUS readout as well as a hover readout, in an aria-live
     |   region, so it is reachable by keyboard.
     |   The viewer overlay is a ring marker distinguishable by shape and stroke rather
     |   than hue, so it survives colour removal, plus a literal "Yours" text column in
     |   the table. IR and taxi players ARE marked: the model is player-independent so
     |   they have a real rank, and a reader who owns an injured RB1 wants to see that.
     |   Panel gained an optional headingFocusable prop (tabIndex={-1} on the heading) so
     |   the rail anchor moves keyboard focus rather than only the scroll position (E6-2).
     |   The rail card renders NOTHING when there is no cached curve or the status is
     |   settled or error: the panel below already carries the honest empty state, and an
     |   empty finding card is worse than no card.
     | agent judgment call: the plan does not say how to tell "ranks past the chart's
     |   depth" from "no projection at all" for a rostered but unmatched player, since the
     |   stored curve is already capped at write time. Resolved by joining the small
     |   unmatched-id set against `players` and treating a resolvable pulse position as
     |   past-depth and anything else as no-projection. Documented in overlay.ts.
     | verified: yes (41 tests across rail-summary, overlay and summary: selection ties
     |   and determinism, IR and taxi marking, null-sleeperId handling, the past-depth
     |   versus no-projection split, and every footnote and summary clause)

T-WAR-45 | completed | E5: /api/og/war/[league_id] route, SVG-as-data-URI, brand check, no ?source=, branded not-ready state
     | files: app/api/og/war/[league_id]/route.tsx, app/api/og/war/[league_id]/card.tsx,
     |   app/api/og/war/[league_id]/route.test.ts
     | depends on: T-WAR-34, T-WAR-44
     | notes: the agent EMPIRICALLY confirmed the data-URI construction works under this
     |   project's next/og version, with a throwaway probe, before committing to it,
     |   rather than trusting the plan's assertion. buildWarSvg draws only from
     |   buildChartGeometry output; no coordinate is recomputed.
     |   Next's route type-checker rejects any export from a route.tsx other than runtime
     |   and the handler, so every testable helper lives in card.tsx.
     |   The plan's mockup showed a middle dot in the meta line. The three existing OG
     |   routes actually use a plain comma, so this one matches the code rather than the
     |   mockup, which also keeps it inside the repo's punctuation rule.
     |   The brand test scans both source files with comments stripped and asserts every
     |   hex literal is a member of BRAND union POSITION_SERIES, rather than checking
     |   against a hardcoded denylist.
     | collision caught and resolved mid-flight: the agent started before
     |   components/league-war/ existed and wrote its own scarcest/deepest selection in
     |   lib/positional-war/summary.ts. When the panel agent's
     |   components/league-war/selection.ts landed with a more complete implementation
     |   (a canonical position-order tertiary tiebreak, and a correctly null `deepest` for
     |   a one-position league), it DELETED its own copy and rewired to import theirs.
     |   There is one selection function, not two.
     | verified: yes (28 tests, E5-1 through E5-6 all covered by real GET invocations
     |   because ImageResponse turned out to render fine under vitest; build shows the
     |   route in the manifest at a footprint matching the other OG routes)

T-WAR-21 | completed | Mount on the overview main column under PowerRankingsSection in its own Suspense boundary
T-WAR-43 | completed | E5: /leagues/[league_id]/positional-war route inside LeagueShell + ExploreLink + metadata
T-WAR-22 | completed | Mirror the panel on /leagues/[id]/power-pulse under ProjectedChampion
     | files: app/leagues/[league_id]/page.tsx, app/leagues/[league_id]/positional-war/page.tsx,
     |   app/leagues/[league_id]/power-pulse/page.tsx, components/league-shell/nav-items.ts,
     |   components/app-shell/nav-icons.ts
     | depends on: T-WAR-20
     | notes: the panel sits in the overview's MAIN column, not the 340px rail, because
     |   six series plus a y-axis plus a legend do not fit in 290px of plot area: the
     |   series become indistinguishable, the tick labels collide, and the legend toggles
     |   cannot hold their 44x44 target. The rail carries the FINDING instead, as text.
     |   Last in DOM order on the main column, so on a phone it lands after the rankings.
     |   The aside's aria-label became "League findings and links", since it now carries a
     |   finding above the navigation list.
     |   The dedicated route is a real League Pulse section: registered in LeagueTabId and
     |   LEAGUE_NAV_ITEMS with a trendingDown icon added to the nav icon registry, so it
     |   appears in the desktop rail AND the mobile sheet rather than one of the two.
     |   leagueTabHref knows it is a full route. Its generateMetadata points at
     |   /api/og/war/[league_id] rather than the league card, because this page's whole
     |   point is the curve (E5-7).
     |   The route's derived pulse runs in its own Suspense boundary rendering null, so
     |   the masthead paints without waiting for the computation.
     | verified: yes (typecheck clean)

## Live validation against production data

Run by the orchestrator (me), not a sub-agent, before the review pass.

BUG FOUND AND FIXED: `npm run calculate:positional-war` threw
`Invariant: incrementalCache missing in unstable_cache` before reading a single
row. `unstable_cache` needs a Next.js incremental cache, which exists during a
request and does not exist in a plain node process, so the whole standalone
recompute path was unusable. `loadWarUniverse` now catches THAT invariant
specifically and falls through to the uncached read. The catch is deliberately
narrow: a short paged read or a query error still throws, because those are the
failures that would otherwise shrink the universe and silently raise every
replacement level. Fixed in lib/positional-war/load.ts.

Universe, confirmed against live 2026 data. WR 413, RB 233, TE 230, QB 133,
K 42, DEF 32, weeks 1 to 18. Exactly the numbers the plan's section 2 claims.

Dynasty Darlings (12 teams, QB/RB/RB/WR/WR/TE/FLEX/FLEX/FLEX/K, no DEF slot):

| Pos | Demand | Replacement | rank-1 WAR | at demand | cliff | curve |
| RB | 32 | 8.89 | 2.353 | 0.191 | 8 | 80 |
| WR | 46 | 9.15 | 2.028 | 0.146 | 9 | 115 |
| TE | 18 | 8.96 | 1.104 | 0.151 | 6 | 45 |
| QB | 12 | 17.19 | 0.398 | 0.155 | 11 | 30 |
| K  | 12 | 7.30 | 0.292 | 0.051 | 5 | 30 |

- No DEF curve, because the league runs no DEF slot. Correct.
- Seated totals: RB 32 + WR 46 + TE 18 = 96, which is (2+2+1+3) * 12 exactly.
  Plus QB 12 and K 12 is 120, which is 10 slots * 12 teams exactly.
- Depth caps are max(24, ceil(demand * 2.5)) at every position.
- war_at_demand is POSITIVE at all five, which is the plan's acceptance
  criterion 9 and the consequence it says must not be "fixed" later.
- Against the plan's section 4.7 bands: QB 0.398 sits inside 0.35 to 0.45. TE
  1.104 is just above 1.0. RB and WR run above the bands because this league
  runs THREE flex slots rather than one, so demand is 32 and 46 rather than 28
  and 42, replacement falls, and rank-1 WAR rises. That is the model working.
  Nothing is outside a factor of two, which is the plan's own bug threshold.
- K at 0.292 against a rough 0.1 estimate is the widest gap. The plan's estimate
  was a generic-PPR back-of-envelope; this league scores kickers under its own
  settings, and K is the position where a small absolute difference is a large
  ratio. Worth watching, not a defect.

King of Kings (12 teams, superflex), the plan's sharpest test:
- QB structural demand 24, exactly 2 * teamCount, so SUPER_FLEX seats a second
  quarterback on every team.
- QB replacement falls from 17.19 (one-QB league) to 13.22.
- QB rank-1 WAR rises from 0.398 to 0.768, a 93 percent jump against the 40
  percent the plan's acceptance criterion 7 requires.

The QB curve stops at 43 rather than its 60 cap. Checked: exactly 43 of the 133
QBs in the universe have any published numbers at all, and 90 have projection
rows with an empty stat line AND a null points column. The engine scored 43 and
refused to invent the other 90. That is "a null projection is never a zero"
working end to end on live data, and it is why rank mode's truncation is the
honest picture rather than a rendering gap.

E4 sharing, proven on live data:
- Two leagues with genuinely different scoring (68 keys against 67) produced
  DIFFERENT fingerprints and both computed fresh. The guard correctly declined
  to share two leagues that are not the same.
- Two leagues with byte-identical scoring, roster positions, team count and
  playoff week start produced the SAME fingerprint. The second returned
  shared=true in 1,177ms against roughly 10,200ms for a fresh compute, an 8.7x
  saving, and performed no universe load.
- All four positions' curves compare byte-identical between the two leagues,
  along with structural_demand and war_rank_1. That is acceptance criterion E4-1.

SECOND BUG FOUND AND FIXED, also by live testing rather than by a test.
`npm run calculate:positional-war` called `calculateLeaguePositionalWar`
directly, which writes cache rows and NO verdict. So a manually recomputed
league kept a null `positional_war_succeeded_at` while its `last_pulsed_at`
stayed recent, and that exact combination is what the admin league-health view
reads as the signature of a systemic break. A successful manual recompute would
have reported itself as a failure, and nobody would have noticed until an admin
looked at the health view and saw healthy leagues listed as broken.

Fix: extracted `runWithVerdict(supabase, leagueRowId, options, attemptedAt)`
from `refreshPositionalWar`, so the page path and the script share ONE copy of
the stamp-calculate-write ordering, and pointed the script at it. Verified live:
the league now carries status `ok`, detail `5 positions, shared, 1113ms`, and
both timestamps. `refreshPositionalWar`'s 28 tests still pass unchanged.

That force run also re-proved the sharing path from a different direction: the
same league recomputed with `--force` came back `shared=true` in 1,113ms,
because another league had already computed that fingerprint. Forcing bypasses
the freshness gate, not the compute sharing, which is the intended behaviour.

THIRD BUG FOUND AND FIXED, again by checking against production rather than by
a test. The admin league-health view's systemic-break signature was "succeeded_at
is null while last_pulsed_at is inside the 48-hour window", with leagues that
have never been viewed excluded on the grounds that their last_pulsed_at is
null.

But `last_pulsed_at` is written by the LEAGUE sync, not by either feature. A
league pulsed yesterday that has simply never had Positional WAR computed has a
recent last_pulsed_at and a null succeeded_at through no fault of anything.
Counted against production: 55 of 212 leagues matched on the day this shipped.
A health view whose first act is to report a quarter of the estate as broken
teaches an admin to stop reading it, which is the exact opposite of its purpose.

Fix: `staleSignature` now also requires `attempted_at` to be non-null. A feature
that has never been attempted for a league is not failing for that league, it is
waiting for someone to open the page. The page's own explanatory copy was
updated to match, so the stated rule and the implemented rule agree.

## E1b - The upgrade what-if

T-WAR-47 | completed | E1b: upgrade what-if server action, validate then claim then simulate, computeLineupSwap + simulateWithReplacements
T-WAR-48 | completed | E1b: upgrade panel UI, both labels, never one column, Signal Guide link, all six empty states
     | files: lib/positional-war/upgrade.ts, lib/positional-war/upgrade.test.ts,
     |   app/leagues/[league_id]/positional-war/actions.ts,
     |   components/league-war/upgrade-panel.tsx,
     |   app/leagues/[league_id]/positional-war/page.tsx
     | depends on: T-WAR-46, T-WAR-43, T-WAR-32
     | notes: THE ARCHITECTURAL CONSTRAINT holds. The what-if runs only from an explicit
     |   server action, never on a GET and never during a render, and it is not on the
     |   overview at all. The overview renders on every visit, so a simulation there would
     |   spend a rate-limit slot on work nobody asked for. There is no URL that encodes an
     |   upgrade, which is why this needs one bucket rather than Trade Ideas' three-path
     |   arrangement, and the action's header says so.
     |   The four gates, in order: zod shape check with no database read; re-derive the
     |   viewer's roster from rosters.player_ids; claim the slot; simulate. A payload
     |   naming a roster id the derivation did not itself produce is REFUSED rather than
     |   silently corrected to the derived one, because silently swapping teams would
     |   answer a question nobody asked.
     |   Reuses computeLineupSwap and simulateWithReplacements rather than writing new
     |   lineup code, so cascading lineup changes and the refusal to name a bad cut come
     |   for free. Only the viewer's team uses a freshly computed distribution; every
     |   other team reads from league_power_pulse_cache.weekly on BOTH sides, matching
     |   what lib/faab/league-faab.ts already does for a single signing.
     |   Naming: this is the one place both metrics legitimately appear, and it labels
     |   both. lib/positional-war/naming.test.ts allowlists exactly these three files for
     |   the team-specific vocabulary and nothing else.
     | verified: yes (19 tests; full suite 168 files, 2560 tests, typecheck and build clean)

NAMING GUARD FIX, found while the upgrade panel landed: the guard flagged a JSX
comment carrying the task id `T-WAR-48`, because the hyphens put word boundaries
either side of the token and `isCommentLine` did not recognise `{/*` as a
comment opener. An ordinary reference to the plan was reading as an unqualified
metric name. Added `{/*` to the comment detector, with the reason recorded in
the code so the next person does not remove it.

Plan-versus-code note from the E1b agent, worth carrying forward: the plan's
edge-case table implies `computeLineupSwap` can return a non-null `dropNote`
from a plain `mustDrop: true` call. Tracing `lib/faab/marginal.ts` shows that
message only fires when a `dropGuard` is configured, which the plan's own
five-field computation spec for this feature does not include. The pass-through
is correct and is covered by a test that mocks the return, but in practice that
sixth empty state cannot fire today. Wiring the value and drop-guard inputs
would make it reachable and is a deliberate follow-up rather than part of this
build.

## Review pass: four independent sub-agents

T-WAR-53 | completed | Accessibility audit sub-agent (WCAG 2.2 AA across every surface)
T-WAR-54 | completed | Security review sub-agent (RLS, the action's gates, the OG route, admin gates)
         | plus an implementation-correctness reviewer and a speed/performance reviewer,
         | four in total, each told to stay in its lane and be adversarial about what
         | the tests do not cover.

CONFIRMED BY THE REVIEWERS, against the live database and the real code rather
than against the plan's claims:
- RLS works on both new tables. anon and authenticated read the per-league cache
  and are refused on write; both are blocked entirely from positional_war_curves
  against a table proven to hold rows as owner, so that is RLS and not emptiness.
- All twelve of the plan's most-likely-to-be-wrong areas hold, including the
  single optimizer call site, the anti-double-count and its regression guard,
  structural-versus-weekly on every consumer, and the write ordering in both
  features.
- No duplicate implementation survived the concurrent build: one selection
  function, one geometry function, and the OG route and the page call the same
  one.
- The palette's claimed contrast ratios were independently recomputed and match.
- No data is hidden at any breakpoint on any Positional WAR surface.

SEVEN FINDINGS ACTED ON:
1. (perf, most severe) A cold curve was blocking the RANKINGS TABLE, not the
   chart. pulseLeagueDerived is awaited by the rankings boundary, not the
   curve's, so a ten-second cold compute held up the page's primary content
   while the curve's own skeleton resolved instantly. Fixed with
   includePositionalWar on pulseLeagueDerived plus a PositionalWarSection server
   component that owns the compute behind the boundary that shows it. A
   deliberate divergence from the plan's section 12, reasoning written into both
   files.
2. (a11y) The overlay dropped the injury designation section 15.1.1 requires.
   injuryStatus now rides on the curve, into the spoken readout and into a new
   Status column.
3. (impl) Orphaned rows when a league stops starting a position. Scoped delete
   after the write, plus a test.
4. (a11y) h2 to h4 heading skip on all three pages. ChartFigure's title level is
   now a prop defaulting to 4, so Beacon Breakdown is untouched, and this panel
   passes 3.
5. (a11y) The live region could rattle through announcements on a pointer sweep.
   The SPOKEN readout is debounced; the visible one still tracks exactly.
6. (security) Unguarded PostgREST .or() filter in resolveUnmatchedOwnerInfo.
   Same character-class guard, same reasoning, as lib/power-pulse/load.ts.
7. (security) No cheap meter before the upgrade action's reads. Added a
   deliberately loose outer bucket claimed before any read, plus a test.

Plus two performance fixes delegated from the same pass: parallelizing the
independent chunk loops in the universe loader, and sharing the viewer reads
through React cache() the way the curve read already was.

RECORDED, NOT ACTED ON, each with a stated reason in the review document: the
axis toggle's sub-44px height from sm up (it is a copy of the existing toggle
and changing one would make the pair inconsistent), a redundant index that is a
strict prefix of the unique one, unverified mobile chart readability at 320px,
and one empty state the reviewer judged unreachable.

MEASURED AFTER THE PERFORMANCE FIXES: with positional_war_curves emptied so the
compute genuinely ran cold, the same superflex league went from 9,525ms to
5,111ms. Roughly half, from parallelizing chunk loops that were never sequential
for a reason. Still not fast, and the remaining time is still round trips.

FINAL STATE: typecheck clean, npm run build clean with /api/og/war/[league_id]
and /leagues/[league_id]/positional-war both in the route manifest, 168 test
files, 2563 tests, all green. Nothing committed, nothing pushed. HEAD is still
c068818.

Note on the cold-path measurement: the performance agent could not reproduce a
cold compute, because its forced run found the fingerprint already shared by
another league and short-circuited before touching the loader, and it correctly
declined to bust the shared cache to manufacture a number. The orchestrator
measured it instead by emptying positional_war_curves first, which is safe
because that table is regenerable and pruned weekly anyway: 9,525ms before the
parallelization, 5,111ms after, same league, same window.

## Follow-up pass: the four recorded findings, plus a performance audit

Run after the review above, against the same working tree. Nothing committed.

### The findings the review recorded but did not act on

T-WAR-55 | completed | Mobile chart readability, settled with a rendering rather than arithmetic
     | files: lib/positional-war/chart-layout.ts, lib/positional-war/chart-layout.test.ts,
     |        components/league-war/positional-war-chart.tsx
     | The plan's named risk was six curves overlapping. Measured, the type was
     | the worse problem, and it is the one a desktop screenshot cannot show. The
     | chart drew into a fixed 640 by 360 viewBox and let the browser scale it,
     | so an axis label set at 9 units rendered at 9 * (containerWidth / 640).
     | The container is not the viewport: a 320px phone leaves the chart 224 CSS
     | px after the page gutter, the Panel body and the ChartFigure, which puts
     | every axis label on both axes at about 3 CSS px.
     | Fixed the way the plan prescribes: below 640 CSS px the coordinate space
     | is sized to the container, so the scale factor is never below 1 and a
     | 10-unit label never renders under 10 CSS px, and the aspect ratio grows
     | as the container narrows so six curves get vertical room. Never fewer
     | series. A priority-ordered label fitter keeps "Replacement level" and
     | drops the decimals it would smear into; every dropped label's value is
     | still in the data table, so nothing is hidden at any breakpoint.
     | The measured width is floored to a 20px quantum, deliberately DOWN, so
     | the coordinate space can never end up wider than the container.
     | verified: yes (17 unit tests including a per-pixel sweep from 200 to 1400
     |           CSS px asserting the rendered label size never drops below 9,
     |           plus a rendering of the real league at 224px, before and after)

T-WAR-56 | completed | Tap targets: 44px at every width on both axis-mode toggles
     | files: components/league-war/war-axis-toggle.tsx, components/power-pulse/rank-mode-toggle.tsx
     | The review declined to fix this in one file because it would make the
     | pair inconsistent. Fixed in both, which removes that objection. sm starts
     | at 640px; a tablet and a large phone turned sideways are both touch
     | devices well past that line.
     | verified: yes (typecheck, build, full suite)
     | note: `sm:min-h-0` appears on four other controls elsewhere in the app
     |       (team-chip-bar, brief-sidebar, board-editor). Out of scope here and
     |       worth its own sweep.

T-WAR-57 | completed | Migration 0216: drop the redundant index, add the one the read path needed
     | files: supabase/migrations/0216_positional_war_read_path_indexes.sql
     | Dropped idx_league_positional_war_cache_league, a strict prefix of the
     | unique index, verified on production by dropping it inside a rolled-back
     | transaction and re-planning both reads.
     | Added idx_player_weekly_projections_season_updated for
     | loadProjectionsSnapshot, which runs on EVERY league page view and was
     | reading all 18,413 rows of the season to top-N sort for one value.
     | Measured on production: 28.1ms and 18,659 shared buffer hits, down to
     | 0.05ms and 12.
     | verified: yes (RLS posture re-queried on both tables and unchanged;
     |           Supabase security advisor clean of anything new)

T-WAR-58 | completed | The unreachable empty state, in the panel, the rail and the OG card
     | files: components/league-war/positional-war-panel.tsx,
     |        components/league-war/war-rail-summary.tsx,
     |        app/api/og/war/[league_id]/route.tsx
     | `curves.every((c) => c.curve.length === 0)` rather than
     | `curves.length === 0`. An empty array satisfies `every`, so the original
     | no-rows case is unchanged and rows-with-no-points now resolve to the same
     | honest "nothing to plot" answer instead of an empty chart frame beside a
     | "not calculated yet" sentence.
     | verified: yes

T-WAR-59 | completed | The upgrade panel's unreachable sixth empty state, removed rather than faked
     | files: lib/positional-war/upgrade.ts, components/league-war/upgrade-panel.tsx,
     |        lib/positional-war/upgrade.test.ts
     | Both branches of chooseDrop that produce a note require a drop guard, and
     | this caller configures none, so `dropNote` was structurally always null
     | and the panel's paragraph could not render. The guard is not simply
     | missing: both its modes rank the roster by trade VALUE, and Positional WAR
     | is source-independent by contract, so wiring one would put a value-source
     | dependency into a surface whose whole point is that the source toggle
     | cannot change it.
     | The pass-through is gone and the test now pins the INPUT (no dropGuard, no
     | rosterValues, no candidateValue) rather than asserting a pass-through
     | against a mocked return the real call cannot produce. If a guard is ever
     | configured here the test fails and says to bring the sentence back.
     | verified: yes

T-WAR-60 | completed | The Signal Guide link opens the guide in place, at the term
     | files: lib/guide/open-guide.ts, components/signal-guide/guide-term-link.tsx,
     |        components/signal-guide/signal-guide-mount.tsx,
     |        components/signal-guide/guide-panel.tsx, lib/guide/registry.ts,
     |        lib/guide/registry.test.ts, components/trade-ideas/trade-outcome.tsx,
     |        supabase/migrations/0217_signal_guide_league_section_pages.sql
     | The review's stated blocker was that no deep-link mechanism existed and
     | that /leagues/[id]/trade-ideas was not in the guide page registry. Both
     | are now built, generally rather than for this one card.
     | A module-level bus carries two directions of traffic: the mount publishes
     | whether the current page HAS a guide, and any component can request an
     | open at a named entry. GuideTermLink renders a real opener when a guide
     | exists and the League Overview link it used to be when one does not, so
     | it degrades rather than becoming a control that does nothing. Server
     | rendering always produces the link and upgrades on hydration.
     | The panel resolves the heading against the FULL content, expands that
     | entry, scrolls to it and moves focus to it, and its own focus timer stands
     | down so a screen reader hears the term rather than an empty search field.
     | A nonce makes the same heading twice count as two requests.
     | Migration 0217 registers the Trade Ideas and Positional WAR section
     | routes, which is what gives those pages a panel at all. The "Positional
     | WAR" term is is_global (0213), so it already surfaces in both.
     | verified: yes (registry tests including a guard that a new section route
     |           cannot fall through to league-overview's guide; confirmed in a
     |           browser against the production build that the Guide launcher now
     |           appears on /leagues/[id]/trade-ideas and its panel carries the
     |           Positional WAR term, which sits 33rd of 33 and is exactly why a
     |           deep link earns its place)

T-WAR-61 | completed | Migration 0218: Signal Guide global term "WAR (wins above replacement)"
     | files: supabase/migrations/0218_signal_guide_war_term.sql,
     |        lib/guides/fantasy-football-terms.ts
     | A short, plain-language definition of the acronym itself, separate from
     | the 2,180-character "Positional WAR" entry that explains the metric. One
     | row in guide_entries covers the Signal Guide panel AND BEAM, which reads
     | the same table (lib/beam/capabilities/glossary-term.ts). The matching
     | glossary entry was added to /guides/fantasy-football-terms, where it also
     | reaches the page's schema.org DefinedTerm block.
     | The heading shape is load-bearing: BEAM scores an exact heading match
     | above a prefix match above a substring hit, so "what is WAR" lands on the
     | new entry (59.7 to 9.9) while "what is Positional WAR" still lands on the
     | full one (109.9). Verified by reproducing that scoring against production.
     | verified: yes

### Performance audit

Measured on the real database from a developer machine, so absolute latencies
carry this machine's round-trip time. The BEFORE and AFTER numbers were taken
back to back in the same minute against the same league, so the ratios hold.

T-WAR-62 | completed | The lineup optimizer's inner loop
     | files: lib/power-pulse/lineup.ts
     | A CPU profile of a cold compute put 4,343ms of 7,460ms total samples in
     | one anonymous function in lib/power-pulse/lineup.ts, which contradicts the
     | review's conclusion that the engine's arithmetic was negligible next to
     | I/O. buildOptimalLineup rebuilt a candidate's eligible-slot array on every
     | seat attempt, scanning all 120 merged slots and running Array.includes over
     | each one's eligibility list, and allocated a Set per offer.
     | Eligibility depends on POSITION and nothing else, so it is now precomputed
     | once per fill, and a stamped Int32Array replaces the per-offer Set.
     | 13 weekly fills on the real league: 1,108ms before, and the WHOLE engine
     | (14 fills plus every quantity read off them) is 175ms after.
     | This also speeds up Power Pulse, FAAB and Trade Ideas, which run the same
     | optimizer per candidate.
     | verified: yes (640 randomized cases across four roster shapes including
     |           overlapping non-nested slots, four team counts and 40 universes
     |           each: 640 of 640 byte-identical to the original implementation)

T-WAR-63 | completed | One scan of the projection window, not two
     | files: lib/positional-war/load.ts, lib/power-pulse/load.ts
     | The loader read the window twice: once for (id, player_id) to learn which
     | players exist, then again through loadProjections for the full rows of
     | exactly those players. The second read returns a strict subset of the
     | first read's rows. Positional WAR's universe is by definition every player
     | with a projection in the window, so the two sets are the same set.
     | It now makes one pass for full rows and derives the id set from what came
     | back, and the completeness count runs alongside the walks instead of ahead
     | of them. The guard is unchanged in substance and still compares against an
     | exact count over the whole window.
     | Also: resolveUniversePlayers asks Postgres for
     | `metadata->sleeper->>injury_status` instead of selecting the whole
     | metadata column, which averages 2kB per row across 1,083 players, to read
     | one string. loadAccuracy's four-chunk loop was serial and now runs
     | concurrently under the same cap as its siblings.
     | Universe load: 1,872-2,062ms before, 719-739ms after, identical row and
     | player counts.
     | verified: yes (12 real 2026 leagues, 8/10/12 teams, two scoring bases,
     |           full model run on the old loader's universe and the new one:
     |           12 of 12 byte-identical curve JSON)
     | note: PAGE stays at 1000. PostgREST caps this project at 1000 rows per
     |       response, so limit(2000) silently returns 1000 and the walk's
     |       short-page stop condition ends it early. Measured: 12,623 of 13,064
     |       rows. Documented in the loader so nobody optimizes it again.

T-WAR-64 | completed | The warm gate: seven serial round trips per page view, now two waves
     | files: lib/league-positional-war.ts
     | Every view of a league page whose curve is already fresh ran the whole
     | gate, and it ran serially: a leagues read for the season, a second leagues
     | read for the backoff columns, the cache row, then loadLeague, the settings,
     | total_rosters, a roster count and the projections snapshot.
     | The two leagues reads were the same row of the same table a few lines
     | apart and are now one. The context builds in two waves split at the week
     | window, which is the only real dependency in it. The memo caches the
     | PROMISE rather than the resolved value, so two concurrent askers share one
     | build instead of both starting their own, and the built context is now
     | threaded into the compute, which used to rebuild the whole thing.
     | Warm gate: 543-557ms before, 276-278ms after.
     | Also hardened: a throw inside the gate now writes an error verdict and
     | stamps attempted_at, so it backs off instead of rerunning the same failing
     | read on every view.
     | verified: yes (28 orchestrator tests unchanged and green)

T-WAR-65 | completed | The read path stops fetching a column nothing renders
     | files: lib/positional-war/types.ts, lib/league-positional-war-data.ts, and
     |        the six consumers now typed against PlottableCurve
     | loadPositionalWarView was a `select("*")`, which pulled
     | weekly_diagnostics, about 6.5kB of jsonb per league, on every league page
     | view to throw it away. PositionCurve is now PlottableCurve plus that
     | field, the read path is typed against PlottableCurve and selects an
     | explicit column list. Left out of the TYPE rather than filled with an
     | empty array, because an empty array would say the engine produced no
     | diagnostics and it produced one per week. Still written, still stored.
     | verified: yes

MEASURED, END TO END, against `next start` on the production build:
- Overview page: first byte 77ms, rankings table in the stream at 239ms, the
  Positional WAR panel at 932ms, stream ends at 2,576ms. The review's fix 1
  still holds: the curve does not block the primary content.
- Positional WAR page: first byte 150-230ms, full stream 864-924ms across seven
  consecutive requests.
- /api/og/war: 380-490ms uncached, 55kB, edge-cached for an hour.
- Cold compute end to end, positional_war_curves emptied first so it genuinely
  ran cold: 1,560-2,064ms, median 1,607ms.

MEASURED AND NOT ACTED ON, with reasons:
- The cached universe serializes to 4.9MB for a 13-week window and 6.8MB for a
  full season. Next's in-memory data cache is 50MB by default and a hosted Data
  Cache typically caps an entry well below this, so the memoization should be
  assumed to be per-instance rather than shared. It is not the bottleneck it
  looks like: positional_war_curves already shares the expensive COMPUTE across
  leagues by fingerprint, so a universe miss is bounded by distinct fingerprints
  rather than by league count. Trimming it is possible but not cheap: stat_line
  is 2.4MB of the 4.9MB and the engine scores every league under its own
  settings, so it cannot be pruned by key; dropping zero-valued keys recovers
  0.25MB, which does not change the outcome and does change what
  projectPlayerWeek sees.
- Raising DB_CHUNK_CONCURRENCY from 5 to 8 cut the projection scan from 619ms to
  445ms in isolation. Left at 5: the cap is shared with Power Pulse and the
  reason for 5 is connection-pool headroom under concurrent requests, which a
  single-request benchmark cannot see.
- The Positional WAR page serves 794kB of HTML, 79kB gzipped. 203kB of that is
  the data table of every plotted player, which is the accessibility contract.
  Not worth restructuring.
- positional_war_curves.first_league_id has no covering index (Supabase advisor,
  INFO). It is provenance, never queried by, so an index would cost writes for
  nothing. It does mean a league DELETE scans the table; that table is small and
  leagues are not deleted in normal operation.

FIXED ALONG THE WAY, and worth naming because it was not a review finding:
lib/positional-war/share.test.ts asserted that two concurrently computed upserts
were deeply equal, including `computed_at`. Each call stamps its own
`new Date()`, so the assertion was that two clock reads landed in the same
millisecond. It passed almost always and flaked the rest of the time. It now
compares the payloads with the clock-read columns excluded and asserts
separately that each one parses as a date, which is what the test was actually
about: a concurrent second writer overwrites with the same CURVE data.

FINAL STATE: typecheck clean, npm run build clean with /api/og/war/[league_id]
and /leagues/[league_id]/positional-war both in the route manifest, 169 test
files, 2,585 tests, all green. Nothing committed, nothing pushed. HEAD is still
c068818.

# My Beacon: Draft Tracker

The manual draft board, for a draft FF Beacon cannot see: one in a room, or one
on a platform we do not sync with. Lives at /my-beacon/draft-tracker with the
board at /my-beacon/draft-tracker/[trackerId].

THE NAME. "Draft Tracker", because somebody arriving from the dashboard has to
know what it does without a glossary, and what it does is track a draft. On The
Clock is the live room for a Sleeper draft we can read; this is the pad of paper
for one we cannot.

T692 | completed | Two user-owned tables for a draft nobody else can see
     | files: supabase/migrations/0219_user_draft_trackers.sql,
     |   lib/database.types.ts
     | depends on: none
     | user_draft_trackers and user_draft_tracker_picks, shaped after
     | user_ranking_boards (0056): owner-only for authenticated, nothing at all
     | for anon, service_role for admin. Picks inherit ownership through their
     | parent tracker, so a guessed tracker_id reads and writes nothing.
     | Verified on production inside begin/rollback: anon sees 0 rows, the owner
     | sees both of theirs, a second signed-in account sees 0 of either, and
     | both write attacks (a forged tracker for another user, a pick attached to
     | a tracker the caller does not own) fail with 42501.
     | NO pick_number COLUMN. Pick order is read off created_at, so undoing a
     | pick in the middle renumbers the ones after it for free, and a
     | double-click cannot collide on a stored integer.
     | Format lives on the tracker, not on the reader. A draft is run under one
     | set of rules decided before the first pick; letting the header's format
     | toggle move it mid draft would reorder the list under somebody's hand.
     | verified: yes (RLS proven on prod, types regenerated)

T693 | completed | Ordering, filtering and labels, as pure functions
     | files: lib/draft-tracker/types.ts, lib/draft-tracker/order.ts,
     |   lib/draft-tracker/order.test.ts
     | depends on: T692
     | The three orderings answer three different questions and the copy says
     | which: player value from the reader's own source, the Sleeper ADP market
     | for this exact format, or A to Z by last name. A null sort key sinks to
     | the bottom rather than sorting as zero, because a player with no ADP is
     | not the first player off the board. 19 tests.
     | verified: yes

T694 | completed | The board: every draftable player, with the three numbers
     | files: lib/draft-tracker/board.ts, lib/draft-tracker/store.ts
     | depends on: T693
     | Rankings for (format, resolved source) joined to players, value and
     | seven-day movement off player_value_trends (one row per player, not a
     | scan of every snapshot ever written), and Sleeper ADP through the same
     | key mapping On The Clock grades picks against, so a dynasty superflex
     | room is never priced off a redraft market.
     | Memoized per (format, source) on the hourly TTL and the player-values
     | tag: the list is identical for every reader and changes overnight. The
     | reader's own picks are NOT cached and are read live every render.
     | Both paged reads carry an explicit order. Without one, Postgres may hand
     | back a different sequence per page, which duplicates some players and
     | drops others; the PPR ADP market is 1,644 rows, so it pages every time.
     | verified: yes

T695 | completed | Seven writes, each one validated against the tracker's own limits
     | files: app/my-beacon/draft-tracker/actions.ts
     | depends on: T692
     | Session, then re-read the tracker under the caller's own user_id, then
     | validate, then write. A team slot outside the room is refused rather than
     | clamped, because silently moving a pick to a different manager is worse
     | than saying no. 25 saved drafts per account.
     | The pick write is an UPSERT on (tracker_id, player_id), not an insert.
     | Tapping Mine and then Gone half a second apart hit the unique constraint
     | on the second write, and the screen would then show the player as gone
     | while the database still had him on the reader's own team.
     | The pick path does NOT revalidate. Everything under /my-beacon is
     | force-dynamic, so there is no cached page to bust and the only effect
     | would be refetching the whole board after every pick.
     | verified: yes

T696 | completed | Set up a draft in four answers
     | files: app/my-beacon/draft-tracker/page.tsx,
     |   app/my-beacon/draft-tracker/start-draft-form.tsx,
     |   app/my-beacon/draft-tracker/delete-tracker-button.tsx
     | depends on: T695
     | Ordering, then format, then how much of the room to track, then a name.
     | Tracking is asked before the board exists rather than sprung on the
     | reader mid draft, because it is what decides what the second button on
     | every row does. Team names are optional and stay collapsed until asked
     | for; an unnamed slot reads as "Team 4" everywhere.
     | verified: yes

T697 | completed | The room: board, rosters, and an undo for every tap
     | files: app/my-beacon/draft-tracker/[trackerId]/page.tsx,
     |   app/my-beacon/draft-tracker/[trackerId]/draft-room.tsx,
     |   app/my-beacon/draft-tracker/[trackerId]/available-players.tsx,
     |   app/my-beacon/draft-tracker/[trackerId]/assign-team-dialog.tsx,
     |   app/my-beacon/draft-tracker/[trackerId]/team-rosters.tsx,
     |   app/my-beacon/draft-tracker/[trackerId]/team-names-dialog.tsx
     | depends on: T694, T695, T696
     | Every button changes the screen first and calls its action second; a
     | failure rolls the change back and says why, on screen and out loud. A
     | draft moves faster than a round trip.
     | Tracking one team: Gone removes the player, and he comes back from the
     | "Taken by someone else" list or the Undo button in the header. Tracking
     | the room: Gone opens the shared slide-up dialog, one tap per team, plus
     | "Not sure yet" because somebody often knows a player is gone before they
     | know who called it, and the alternative is leaving him on the board.
     | Mobile keeps every number: tier, ADP and value leave their columns below
     | sm and come back as one line under the name, and the two action buttons
     | stack rather than shrink.
     | verified: yes

T698 | completed | Wire it into the navigation
     | files: lib/nav-tree.ts, lib/breadcrumbs.ts, app/my-beacon/page.tsx
     | depends on: T697
     | verified: yes

## Review pass: four independent sub-agents

Implementation, security, accessibility, and performance, each reading the same
sixteen files with no knowledge of the others. Eleven confirmed bugs and one
blocker between them. Everything below is fixed and re-verified.

T699 | completed | Both caps enforced in the database, not only in the action
     | files: supabase/migrations/0220_draft_tracker_limits_in_the_database.sql
     | depends on: T695
     | The security review MEASURED two write-arounds. Every signed-in reader
     | holds the publishable key (inlined in the browser bundle, which is
     | correct) plus their own JWT, which is a working PostgREST endpoint
     | against their own rows. RLS was doing its job; RLS counts nothing and
     | compares nothing. Writing straight to PostgREST produced 40 trackers
     | against a stated cap of 25, and a pick at team slot 99999 in a one-team
     | draft. The second is the quieter and worse one: the board groups picks by
     | slot, so a pick on a slot that does not exist vanishes from every roster
     | while still counting as off the board.
     | Two triggers now hold the cap, the slot bound, and a 1200-pick-per-draft
     | backstop. Both original attacks re-run and now fail with 23514, and the
     | happy path (valid slot, unknown owner, the reassign UPDATE) still passes.
     | The pick trigger stays SILENT about a tracker it cannot see: a BEFORE
     | trigger runs ahead of the RLS WITH CHECK, so raising there would confirm
     | that a guessed tracker id is real.
     | verified: yes

T700 | completed | Counting picks without fetching them, and freshness in a trigger
     | files: supabase/migrations/0221_draft_tracker_counts_and_freshness.sql,
     |   lib/draft-tracker/store.ts, app/my-beacon/draft-tracker/actions.ts
     | depends on: T699
     | Three findings, one migration. The list page was embedding every pick row
     | of every saved draft to compute two integers per card: up to 30,000 rows
     | for fifty numbers. The second number is a count FILTERED on a column of
     | the parent row, which PostgREST's (count) aggregate cannot express, hence
     | a security_invoker view.
     | Every pick also cost a second round trip whose only job was stamping the
     | parent's updated_at, on the one path with a draft clock against it. A
     | trigger does it in the same statement, so a pick is one round trip again,
     | and the stamp is right whoever writes the pick.
     | And the list ordered by created_at while the card said "Last touched". It
     | orders by updated_at now, so a draft in progress sits above one nobody
     | has opened since March.
     | team_names was shape-checked and nothing else; it is bounded now too.
     | verified: yes

T701 | completed | Hoist auth.uid() out of eight row filters
     | files: supabase/migrations/0222_draft_tracker_policies_hoist_auth_uid.sql
     | depends on: T699
     | Bare auth.uid() re-evaluates per row. Reading a draft's picks is a few
     | hundred rows and clearing the board is a bulk delete over the same set,
     | so one action could call it several hundred times. (select auth.uid())
     | makes it an InitPlan. Predicates otherwise identical to 0219, and
     | cross-user isolation re-proven after the rewrite.
     | verified: yes

T702 | completed | Pin search_path on the three trigger functions
     | files: supabase/migrations/0223_draft_tracker_functions_pin_search_path.sql
     | depends on: T699, T700
     | Supabase lint 0011. All three already schema-qualify every table, so the
     | empty path changes no behaviour, and the trigger set was re-exercised
     | end to end afterwards to prove it.
     | Advisors now report zero findings against anything in this feature.
     | verified: yes

T703 | completed | Focus survives a pick
     | files: app/my-beacon/draft-tracker/[trackerId]/available-players.tsx,
     |   app/my-beacon/draft-tracker/[trackerId]/team-rosters.tsx,
     |   app/my-beacon/draft-tracker/[trackerId]/draft-room.tsx,
     |   app/my-beacon/draft-tracker/saved-drafts-list.tsx,
     |   app/my-beacon/draft-tracker/delete-tracker-button.tsx
     | depends on: T697
     | The accessibility review's only BLOCKER, and it was right. Pressing Mine
     | removes the row, so the button holding focus unmounts and focus falls to
     | the body. A keyboard reader then tabs past the header, the back link,
     | four tiles, three ordering buttons, the search box, seven position chips
     | and three column headers to get back. A 12 team, 15 round draft does that
     | 180 times.
     | Every press now records the player and the seat he sat in, and once he is
     | actually gone focus moves to whoever moved up into that seat. The end of
     | the list falls back to the last row, an emptied list to the search box.
     | Waiting for the player to LEAVE rather than firing on the next render is
     | what makes the same mechanism cover the assign dialog, where the row
     | outlives the press and SlideUpDialog's own restore aims at a button that
     | no longer exists.
     | Busy buttons are aria-disabled, never disabled: setting disabled on a
     | focused element blurs it, which would be a second way to lose focus on the
     | exact press being protected. Deleting a draft now announces and hands
     | focus to the list heading; the toolbar's Undo and Start over stay mounted
     | rather than disappearing under the reader's finger.
     | verified: yes

T704 | completed | Optimistic state that survives two taps at once
     | files: app/my-beacon/draft-tracker/[trackerId]/draft-room.tsx
     | depends on: T697
     | Three real bugs in one mechanism.
     | Rollback restored a whole-array snapshot. Only the row being written is
     | quiet, so a reader can take player B while A is in flight, and A failing
     | would erase B's committed pick and put a drafted player back on the board.
     | Every revert is scoped to one player now, and busyPlayerIds is a set, so
     | finishing one write no longer clears another's marker.
     | Pick order came off the client clock. It is derived from the picks already
     | held (one millisecond past the latest), and re-taking a player keeps his
     | original stamp, which is what the server's upsert does on conflict.
     | The remaining count was read from the previous render, so two fast presses
     | announced the same number twice.
     | verified: yes

T705 | completed | A pick can outlive its player, and still be undone
     | files: app/my-beacon/draft-tracker/[trackerId]/team-rosters.tsx,
     |   app/my-beacon/draft-tracker/[trackerId]/draft-room.tsx,
     |   app/my-beacon/draft-tracker/[trackerId]/assign-team-dialog.tsx
     | depends on: T697
     | Source is reader-controlled and the board is one source's ranked list, so
     | switching source mid draft could drop a drafted player out of the board
     | entirely. Those picks were filtered away: gone from every roster, still
     | counted as off the board, and unreachable short of clearing everything.
     | They render as a row that says what happened and keeps its undo.
     | verified: yes

T706 | completed | Every live region says one thing, once
     | files: app/my-beacon/draft-tracker/[trackerId]/draft-room.tsx,
     |   app/my-beacon/draft-tracker/[trackerId]/available-players.tsx,
     |   app/my-beacon/draft-tracker/[trackerId]/team-names-dialog.tsx,
     |   app/my-beacon/draft-tracker/start-draft-form.tsx,
     |   lib/draft-tracker/order.ts, lib/draft-tracker/order.test.ts
     | depends on: T697
     | Five separate faults the accessibility review found by tracing what a
     | reader actually hears.
     | role="alert" nested inside aria-live="polite" fires twice, once
     | interrupting the other. The wrappers are gone.
     | A failed action set the error AND the polite announcement to the same
     | sentence. Only the alert carries a failure now.
     | "Team names saved." was announced into a region outside the open modal,
     | which is removed from the accessibility tree, so twelve names were typed
     | in and nothing was ever said. The dialog says it itself, then closes.
     | Pressing a sort header fired both regions, one of them to report a count
     | that had not changed.
     | Show more announced NOTHING: the sentence was built from the match count,
     | which the press does not change, so React skipped the DOM write. The one
     | control whose whole job is adding rows the reader cannot see was silent.
     | describeBoard takes the visible count now and a test pins that the string
     | actually differs between presses.
     | verified: yes

T707 | completed | Setup form: honest states and a count that does not fight you
     | files: app/my-beacon/draft-tracker/start-draft-form.tsx
     | depends on: T696
     | Typing "12" in the team count produced 21: the value was clamped on every
     | keystroke, so the "1" snapped up to the minimum of 2 before the "2"
     | landed. Held as text now, settled on blur and on submit.
     | No formats available rendered four questions and a permanently dimmed
     | button with nothing saying why. It renders an honest empty state.
     | The room settings sat inside question 3's fieldset, so its legend was read
     | before all 34 controls; they have their own fieldset. The mode buttons
     | carry aria-controls and aria-expanded, and the disclosure keeps one name
     | and lets aria-expanded carry its state.
     | verified: yes

T708 | completed | Column headers stop repeating their sort instruction
     | files: app/my-beacon/draft-tracker/[trackerId]/available-players.tsx
     | depends on: T697
     | A th's name is computed from its subtree, so the sorting instruction on
     | the button inside it was read before EVERY cell in that column during
     | table navigation: "Sleeper ADP, sort earliest first: 1.4" on 800 rows.
     | Short aria-label on the th, the instruction on the button.
     | Position rank gets its sr-only expansion here too, matching the rosters.
     | verified: yes

T709 | completed | Assign dialog stops claiming a choice was already made
     | files: app/my-beacon/draft-tracker/[trackerId]/assign-team-dialog.tsx
     | depends on: T697
     | aria-current tested currentSlot === null, and a brand new pick opens with
     | currentSlot null, so "Not sure yet" was announced as the current item on
     | every ordinary Gone press. It is gated on isMove now, so placing a player
     | marks nothing current and moving one marks the team he is on.
     | The dialog also names itself from its visible heading rather than an
     | sr-only span, so the name is not said and then immediately repeated.
     | verified: yes

T710 | completed | Payload, queries, and the reads that were doing too much
     | files: lib/draft-tracker/board.ts, lib/draft-tracker/store.ts,
     |   lib/draft-tracker/types.ts, app/my-beacon/draft-tracker/actions.ts,
     |   app/my-beacon/draft-tracker/[trackerId]/team-rosters.tsx
     | depends on: T694
     | change7d, trend7d and show7d were queried, shipped on all 799 rows, and
     | rendered nowhere. Removed as dead code rather than for speed: measured,
     | they are 15% of the uncompressed payload and 1.0 kB brotli.
     | The ADP read pulled the whole adp jsonb (107 kB across the dynasty
     | superflex market) to use one number per row; it selects the one key now.
     | It is also cached on the format alone, because it does not vary by source,
     | so four sources on one format no longer each pay for the same market read.
     | loadTracker ran its two reads in sequence though neither needs the other,
     | and the picks read had no paging (unreachable at BOARD_LIMIT 900, but the
     | constant that keeps it safe lives in another file).
     | setTrackerOrder revalidated the list, which is reachable from six in-draft
     | controls and refetches the whole board; worse, the refetch replaces the
     | pick list and could drop a pick made while it was in flight.
     | TeamRosters is uncapped (240 rows in a 12 by 20 room) and re-rendered three
     | times per pick; memoized, with a stable callback so the memo can hold.
     | verified: yes

T711 | completed | The consistency cleanups
     | files: lib/draft-tracker/types.ts, lib/draft-tracker/order.ts,
     |   lib/draft-tracker/board.ts, app/my-beacon/draft-tracker/actions.ts,
     |   app/my-beacon/draft-tracker/[trackerId]/page.tsx,
     |   app/my-beacon/draft-tracker/page.tsx,
     |   app/my-beacon/draft-tracker/start-draft-form.tsx,
     |   components/slide-up-dialog.tsx
     | depends on: T710
     | BoardPosition is an alias of PositionColorKey and toBoardPosition is gone:
     | it was a byte-for-byte copy of normalizePositionColor, and two components
     | index that module's classes by this type, so a drift would have produced
     | an undefined class name at runtime.
     | sortBoard no longer uses localeCompare. The table server-renders and then
     | hydrates, and Node's locale is not the browser's, so a locale-aware
     | comparison risked a hydration mismatch across all 800 rows.
     | Dead exports removed, the duplicated uuid regex folded into one, the
     | duplicated ORDERS constants folded into DRAFT_ORDERS, teamLabel reused
     | where it had been reimplemented, and revalidatePath routed through the one
     | helper.
     | The value ordering's source name is resolved PER FORMAT now: the reader
     | can pick a format their source does not cover, and the option label was
     | naming a source the board would not use.
     | Source display names are no longer lowercased into sentences (they are
     | proper nouns out of source_registry); orderPhrase exists for that.
     | The breadcrumb showed the raw uuid, split on hyphens and capitalised.
     | SlideUpDialog gained an optional labelledBy so a dialog with a visible
     | heading is not named twice. Additive, every existing caller unchanged.
     | Both pages redirect rather than assert on a missing session: Next renders
     | a layout and its page concurrently, so the layout's redirect cannot be
     | relied on to have happened first.
     | verified: yes

DECLINED, with reasons:
- next/image for player headshots. Real and well measured: the Sleeper CDN
  serves a 350x254, 20.8 kB PNG for a 32px slot, so the first screenful of the
  board is 510 kB of images against 25 kB for the entire 799-player payload.
  But ImageWithFallback is shared by roughly every surface on the site and the
  change belongs in its own task with its own review, not smuggled in here.
  Lazy loading and decoding="async" are already on.
- A rate limiter on the pick path. It would add a database round trip to the one
  interaction with an eight-second clock behind it. The storage consequence,
  which was the actual risk, is now bounded by triggers at 25 drafts of 1200
  picks per account.
- getClaims() in place of getUser(). Removes an auth-server round trip from
  every action and every page render in the space, but it depends on the
  project's JWT signing key setup and it is a site-wide auth change.
- Radiogroup semantics for the four single-select button groups. Accurate, and
  aria-pressed is what On The Clock already uses; consistency wins until both
  change together.
- The two INFO advisors on the new tables: format_config_id has no covering
  index (it is a lookup, never deleted) and idx_user_draft_tracker_picks_player
  reads as unused (it exists for the players FK cascade, and the table is empty).
  Same call, and the same reasoning, as positional_war_curves.first_league_id.

FINAL STATE: typecheck clean, 170 test files and 2,613 tests green, npm run build
clean with both routes in the manifest. Migrations 0219 through 0223 applied to
production and verified there. Supabase advisors report nothing against this
feature. All 22 new and changed files are plain ASCII. Nothing committed, nothing
pushed. HEAD is still d453334.

================================================================================
POSITIONAL WAR DASHBOARD (T-WAR-66 .. T-WAR-75)
================================================================================

The scarcity curve became a player-level dashboard: a cleaner wins-over-
replacement chart, a trade-value scatterplot beside it, and a searchable,
sortable player table under both, all driven by one position filter. The
validated league-specific calculation is unchanged except where a task below
says otherwise and says why.

T-WAR-66 | completed | The oversized data-cache write, fixed by slicing the universe
     | files: lib/positional-war/load.ts, lib/positional-war/load.test.ts
     | The whole universe went into ONE unstable_cache entry. Measured against
     | production (2026, weeks 1-17, ppr): 6.30 MiB, of which 6.08 MiB is
     | 17,394 projection rows and their raw stat_line maps. Next refuses
     | anything over 2 MiB, so the write failed on every cold load ("Failed to
     | set Next.js data cache ... items over 2MB can not be cached") while the
     | read still returned a freshly built universe. The layer never populated
     | and every fingerprint miss rebuilt from Postgres.
     | The stat lines cannot be dropped: each league rescores them under its own
     | Sleeper settings, which is why the model does not vary by format or
     | source.
     | Now stored as several entries, split where the data partitions:
     |   - one per (season, week) of projection rows. Largest measured slice
     |     390 KiB, 19% of the limit, 5.2x headroom. Shared across every week
     |     window AND every scoring base, because a projection row carries all
     |     three scoring columns and its stat line.
     |   - one for resolved players, keyed by a sha256 digest of the exact
     |     player id set (227 KiB).
     |   - one for accuracy, keyed by that digest plus the scoring base (113 KiB).
     |   - one for defense splits, keyed by scoring base and its two seasons
     |     (37 KiB).
     | Keying the id-dependent entries by the id digest is what stops a partial
     | cache silently shrinking the universe: an entry can only be reused for
     | exactly the ids it was built from. The resolve also stores its dropped
     | count and the assembly asserts resolved + dropped === asked.
     | Guards: each week slice carries an exact per-week count guard BEFORE it
     | can be stored, and the assembly still runs one uncached exact count over
     | the whole window on every call, compared against the summed row counts
     | the slices recorded. A stale, evicted or missing slice fails there.
     | Also fixed, latent: the old window guard compared KEPT rows against the
     | count while its own comment said it did not. player_id is nullable on
     | player_weekly_projections, so one null row would have failed a complete
     | read. The slice now records readCount separately.
     | Structure: assembleUniverse() takes its four reads as an argument.
     | directReaders go to Postgres; cachedReaders wrap the same four. So
     | loadWarUniverse and loadWarUniverseUncached are the same function with
     | different readers and cannot drift.
     | verified: yes (24 load tests; byte-identical curves against three
     |           production leagues; measured 15 misses cold, 0 warm)

T-WAR-67 | completed | Position rank is the default axis, and every mode stops at 36
     | files: lib/positional-war/chart-geometry.ts, chart-geometry.test.ts,
     |        components/league-war/war-axis-toggle.tsx,
     |        app/api/og/war/[league_id]/route.tsx
     | parseAxisMode's default flipped to "rank"; `?war=depth` opts into the
     | normalized mode and `?war=rank` still resolves to rank, so no shared link
     | broke. buildChartGeometry gained maxRank (36 by default,
     | WAR_PREVIEW_MAX_RANK 25 for the preview), applied in BOTH modes before
     | anything else, so the y-domain, the ticks, the markers, the truncation
     | flag, the spoken summary, the data table and the OG card all describe one
     | population. The OG card moved to rank mode for the same reason.
     | The replacement marker now clamps in depth mode too: it used to pin to
     | x = 1.0 unconditionally, so a league starting more of a position than the
     | chart plots got a boundary drawn past the end of its own line.
     | geometry.zeroY is new, so the chart can mark zero without the caller
     | inventing a scale.
     | verified: yes (29 geometry tests)

T-WAR-68 | completed | The arbitrary tail, ordered by a real number
     | files: lib/positional-war/engine.ts, engine.test.ts,
     |        lib/positional-war/default-settings.ts
     | With clampBelowReplacement on (the default), every player who never beats
     | weekly replacement scores exactly 0.000 WAR and 0.0 points above
     | replacement. Measured in production, that was ranks 51-78 of one league's
     | WR curve: twenty-eight players tied on both sort keys and ordered by
     | uuid, so WR51 was Anthony Gould and WR74 was Rashod Bateman. A table that
     | sorts by WAR would have inherited that as if it meant something.
     | Tiebreak is now (WAR, points above replacement, projected points a week,
     | player id). It cannot reorder anyone with positive WAR, because WAR is
     | strictly increasing in points above replacement. After the change the
     | same block reads 10.2, 10.0, 9.8, 9.7, 9.7, 9.5 points a week.
     | verified: yes (35 engine tests, three of them new)

T-WAR-69 | completed | The negative-WAR decision: the floor stays, and it is documented
     | files: lib/positional-war/default-settings.ts (the clampBelowReplacement
     |        doc), lib/positional-war/tiers.ts
     | The reference screenshots show WAR down to about -0.5, so this was
     | reviewed rather than assumed.
     | KEEPING THE FLOOR. Season WAR is a SUM over the weeks a player is
     | projected for. In the negative half that makes the model rank a deep
     | backup projected all thirteen weeks BELOW a rookie projected twice,
     | purely because one had more weeks in which to lose. In the positive half
     | the same asymmetry is the point; in the negative half it stops being a
     | claim about football. There is also a fantasy-specific reason: nobody
     | starts a below-replacement player when the replacement is on waivers, so
     | those are not wins anyone would actually give up.
     | The problem the negatives would have solved (an unordered tail) is solved
     | by T-WAR-68 instead, with a real number rather than an invented deficit.
     | The setting stays configurable, and the chart's y-domain is still
     | computed from the data, so turning it off still works.
     | Below-replacement players are still NAMED: the tier reads
     | projectedPointsPerWeek < replacementPointsPerWeek, both of which are
     | stored on the curve point, so "Below replacement" is a fact off the same
     | screen rather than a WAR sign.
     | verified: yes (documented in code; tier tests cover both bottom bands)

T-WAR-70 | completed | WAR tiers, league-relative by construction
     | files: lib/positional-war/tiers.ts, tiers.test.ts
     | Six tiers: League breaker, Elite, Strong advantage, Starter, Replacement
     | level, Below replacement.
     | The thresholds are NOT copied from the screenshots. Season WAR is a sum
     | over the weeks that remain, so the same league in week 14 carries about a
     | quarter of the WAR it carried in week 1 with no projection changed: any
     | fixed threshold in wins would relabel the whole league every few weeks. A
     | share of the best player's WAR is scale-free but hangs the ladder on one
     | outlier.
     | The anchor is the league's own starting jobs: every player ranking inside
     | his position's structural demand, across all positions (about 120 in a
     | 12-team league). League breaker is the top 2% of that distribution, Elite
     | the top 10%, Strong advantage the top 25%, Starter at or above the least
     | valuable starting job. It scales with team count and with lineup shape
     | (superflex adds a dozen QB jobs, so QBs rise with no positional special
     | case), and percentiles do not notice the window shrinking.
     | The two bottom tiers are structural rather than percentile, because below
     | the starters the question is not "where does he rank" but "is he better
     | than a freely available player", and the curve carries both numbers.
     | Guard: a league whose top starting job is worth 0.00 gets no ladder at
     | all rather than a "League breaker" badge on a zero.
     | verified: yes (16 tier tests, including the scale-free property)

T-WAR-71 | completed | The trade value against wins scatterplot
     | files: lib/positional-war/scatter-geometry.ts, scatter-geometry.test.ts,
     |        components/league-war/war-scatter-chart.tsx
     | X is current trade value at the league's resolved format and the reader's
     | chosen source; Y is Positional WAR, which does not vary by source. Each
     | position keeps its line-chart marker SHAPE as well as its colour, so
     | position is never carried by hue alone.
     | A player with no published value is NOT plotted at zero: he is excluded,
     | counted in a stated line, and still listed in the table. A zero would
     | make a false column against the y-axis and drag the trend line into it.
     | The trend line is ordinary least squares and only appears at 20+ plotted
     | players. Its sentence names the sample size and the explained spread, and
     | below an r squared of 0.1 it reports no clear relationship rather than a
     | weak one, because "weak" still invites a reader to lean on it.
     | Nearest-point matching is two-dimensional here, unlike the line chart's
     | x-only match: two players can share a value and sit a full win apart.
     | verified: yes (19 scatter tests)

T-WAR-72 | completed | The player table
     | files: lib/positional-war/table.ts, table.test.ts,
     |        components/league-war/war-player-table.tsx
     | Player, position rank, NFL team, manager (or "Free agent"), tier,
     | Positional WAR, points above replacement, wins per projected week,
     | projected points a week, current trade value. Sortable on every numeric
     | column with aria-sort on the active one, searchable by name, filtered by
     | the shared position control, and downloadable as CSV.
     | "PORP" is deliberately absent: an unexplained acronym in a header is a
     | puzzle, not a label. The column reads "Pts over repl." and its accessible
     | name reads the whole phrase.
     | Nulls sort to the bottom in BOTH directions, because "we do not have this
     | number" is neither a small number nor a large one.
     | Ownership comes from ONE pair of queries over the whole league
     | (loadLeagueOwnership), not one per row. Values come from ONE query
     | against player_value_trends for exactly the rendered ids (at most 216).
     | No N+1 on either.
     | Mobile: the table keeps its natural width inside an overflow-x-auto
     | region, the same construction app/tools/on-the-clock/available-list.tsx
     | uses, so every column, header and sort button is reachable at 320px and
     | nothing is hidden. The player cell additionally repeats position, team,
     | manager and tier as a stacked line below sm, so a row's identity is there
     | without scrolling sideways.
     | verified: yes (16 table tests)

T-WAR-73 | completed | One position filter for three surfaces
     | files: components/league-war/war-dashboard.tsx,
     |        components/league-war/positional-war-chart.tsx,
     |        components/league-war/positional-war-panel.tsx,
     |        components/league-war/positional-war-section.tsx
     | QB, RB, WR and TE show by default; K and DEF are one press away and the
     | legend says what each is worth. Three independent filters would let the
     | three surfaces show three different populations while looking like one
     | view.
     | The chart is controlled when the dashboard drives it and uncontrolled
     | when the preview mounts it, so one component draws both.
     | Point markers shrank from radius 3 to 1.6 (2.6 to 1.5 narrow): a dot per
     | player at 36 ranks turned the series into a bead chain. The active point
     | still grows to 4.
     | The panel gained a variant: "dashboard" for the dedicated page,
     | "preview" for Power Pulse (25 ranks, its own complete data table, a link
     | onward, no scatterplot or player table).
     | verified: yes (full suite green; checked in the browser at 1600px)

T-WAR-74 | completed | Positional WAR left the League Overview entirely
     | files: app/leagues/[league_id]/page.tsx,
     |        components/league-war/war-rail-summary.tsx (deleted)
     | Owner decision, mid-task: the overview should not carry a graph the
     | dedicated page already carries. The chart panel and the rail summary card
     | are both gone, and war-rail-summary.tsx was deleted rather than left
     | unreferenced. components/league-war/selection.ts stays; the chart summary
     | and the OG card both still use it.
     | The practical consequence: the overview no longer awaits
     | refreshPositionalWar at all, so a cold curve costs the page nothing. Its
     | client bundle is 6.34 kB.
     | Discovery is the section nav plus the "Explore this league" link, whose
     | hint now reads "Which positions are hard to replace here".
     | verified: yes (overview HTML contains no chart; 200 in 4.86s)

T-WAR-75 | completed | Plain-language copy, and the guide entries that were missing
     | files: components/league-war/summary.ts, summary.test.ts,
     |        app/leagues/[league_id]/positional-war/page.tsx,
     |        components/league-war/war-axis-toggle.tsx,
     |        supabase/migrations/0224_signal_guide_positional_war_dashboard.sql
     | Every user-facing string assumes the reader has never met WAR. "Wins"
     | became "matchups" in the summaries, the intro leads with what the number
     | estimates, and both the intro and the footnote now say the calculation
     | runs on PROJECTIONS for the games left to play rather than on production.
     | Replacement level is always "the best player at his position who would
     | not make a starting lineup anywhere in this league" and never an average
     | bench or waiver player.
     | Migration 0224: the league-positional-war guide page had a row and ZERO
     | entries. It now carries five questions and two terms. The global
     | "Positional WAR" term was rewritten with a plainer opening and the
     | projections caveat it never had; its deeper paragraphs stay, because that
     | entry is where the detailed methodology lives for advanced readers. The
     | update is guarded on the body still being the shipped copy, so an admin
     | edit survives.
     | verified: yes (migration applied and read back; 7 entries live)

T-WAR-76 | completed | The overview rail: two findings, and one of them is a chart
     | files: components/league-war/war-rail-summary.tsx (restored, rewritten),
     |        components/league-war/positional-war-section.tsx (WarRailSection),
     |        components/league-rail/pulse-favorite-card.tsx (new),
     |        lib/league-pulse-favorite.ts (new), lib/league-pulse-favorite.test.ts,
     |        components/league-war/selection.ts, rail-summary.test.ts,
     |        app/leagues/[league_id]/page.tsx
     | Owner decision: the overview should carry the FINDING, not a second copy
     | of the chart. T-WAR-74 removed both, which was one card too many.
     | The Positional WAR card is back and is now a condensed reading of the
     | dedicated page's first chart rather than three lines of prose: a
     | sparkline of every position's curve (top 12 ranks, drawn by the same
     | buildChartGeometry the full chart and the OG card use, so the rail cannot
     | disagree with the page it links to), then a row per position carrying the
     | series marker shape, the series colour, the position name, a bar, what
     | the best one adds, and how many the league starts. Ordered by what the
     | best one is worth, so the hardest position to replace leads. Colour
     | carries nothing alone: shape, name and printed figure all repeat it, and
     | the sparkline is aria-hidden with every value it draws present as a real
     | table cell below it.
     | Twelve ranks rather than thirty-six because the rail is 340px: a
     | thirty-six point series is eight pixels a player and the drop-off the
     | card exists to show flattens into noise. The card says so and links on.
     | New card above it: who Power Pulse expects to win. Title favorite, the
     | odds as the headline figure, the claim behind it in words, projected
     | record and playoff odds, and a link to the full page. Ties are counted on
     | the ROUNDED percentage the card prints, because two teams at 24.1% and
     | 24.0% both read "24%" and a sole favorite beside a number another team
     | also has is a lie a reader catches.
     | Its read is deliberately NOT loadPowerPulseView: that joins five tables
     | and decodes every team's weekly distribution, drivers and lineup to
     | render a card that names one team. loadPulseFavorite reads the pulse
     | cache and resolves identity for the ONE roster it names.
     | Both render nothing at all when their data is not there yet.
     | Copy: buildYourBestLine now says "matchups" like every other string in
     | the feature, rather than "wins" on one card and "matchups" on the rest.
     | verified: yes (8 new tests for the favorite picker, full suite green,
     |           checked in the browser against a league with both cards, a
     |           league with neither, and a viewer with and without a roster)

T-WAR-77 | completed | includePositionalWar: false was on the wrong boundary, and always had been
     | files: app/leagues/[league_id]/page.tsx
     | Found in a dev server log while verifying T-WAR-76: one cold overview
     | load computed the same league's curve TWICE, 1,114ms and 1,258ms.
     | The flag exists so that the boundary showing the RANKINGS TABLE does not
     | wait on a cold curve. Its comment says exactly that. It has been sitting
     | on TeamsPanel since the feature shipped, which renders no rankings table
     | and no curve, while PowerRankingsSection, which renders the overview's
     | primary content, used the default `true` and awaited the compute on
     | every cold fingerprint. The fix the flag was introduced for never applied
     | to the page it was introduced for.
     | The flag now sits on PowerRankingsSection. TeamsPanel keeps it too, with
     | an accurate comment: that tab renders no Positional WAR either.
     | After: the derived breakdown for a cold overview load carries no
     | positional-war stage at all, and exactly one compute runs, behind
     | WarRailSection's own boundary.
     | verified: yes (dev log, same league, before and after)

T-WYR-01 | completed | Would You Rather: the trade voting game, end to end
     | files: supabase/migrations/0225_would_you_rather.sql,
     |        supabase/migrations/0226_signal_guide_would_you_rather.sql,
     |        lib/would-you-rather/*, lib/discord.ts, lib/league-signal-check.ts,
     |        lib/cron-runs.ts, lib/site.ts, lib/nav-tree.ts, lib/breadcrumbs.ts,
     |        lib/sitemap/sections.ts, lib/guide/registry.ts,
     |        app/games/would-you-rather/*, app/api/games/would-you-rather/*,
     |        app/api/cron/would-you-rather-discord/route.ts,
     |        app/admin/would-you-rather/*, app/api/og/page/[key]/route.tsx,
     |        app/games/page.tsx, app/page.tsx, app/globals.css, vercel.json,
     |        scripts/would-you-rather-pool.ts, package.json
     | A real trade out of a synced league, anonymised to Team A and Team B,
     | put in front of a reader who calls the winner. The reveal is the whole
     | product: the room's split, the full Signal Check verdict, and what that
     | league's own Positional WAR curves, Power Pulse standings and 30-day
     | value trends say about every piece.
     | THE ANSWER NEVER REACHES THE BROWSER BEFORE THE VOTE. WyrRound carries
     | names, positions, pick seats and the league's format and nothing else;
     | WyrReview is built by the vote route AFTER the vote row is written and
     | returned in that response. Nothing verdict-shaped is ever passed to a
     | client component, so it cannot land in the page's flight payload. Checked
     | against the served HTML: no marginPct, winnerSide, verdictLabel,
     | explanation or tally anywhere in it.
     | A VOTE CANNOT BE COUNTED TWICE. Two partial unique indexes on
     | would_you_rather_votes, and the insert is attempted rather than preceded
     | by a SELECT, so two clicks a few ms apart cannot both pass a check. A
     | repeat returns the reveal for the side originally picked and burns no
     | free vote.
     | Guests get two rounds, then the sign-in state. The wall is checked before
     | any grading work, so a reader who cannot vote never costs a query budget.
     | The pool (would_you_rather_trades) holds only trades Signal Check has
     | already graded successfully, so serving is a cheap read. Topped up
     | inline when thin, in bulk by `npm run wyr:pool`, and from the admin
     | panel. Startup draft trades are included and labelled, with each pick
     | shown as the player taken at that seat.
     | Discord: one hourly cron, and the SCHEDULE lives in the admin panel, in
     | America/New_York. Ticking three hours is three posts a day; ticking one
     | is one. Off by default. Posting is claimed by a unique Eastern
     | date-hour slot key so a double tick cannot double post; ingestion is
     | claimed by a conditional update on results_ingested_at and the trade's
     | Discord totals are RECOMPUTED as a sum of its polls rather than
     | incremented.
     | verified: yes (RLS confirmed on all four tables against anon and
     |           authenticated with begin/rollback; guards tested: 401 unauth
     |           cron, 400 missing x-requested-with, 400 bad body, admin page
     |           redirects; guest limit walked to the wall; double vote proved
     |           idempotent; full suite green, 2,849 tests; typecheck and build
     |           clean; played through on desktop and at 400px)

T-WYR-02 | completed | Would You Rather: the four review agents' findings, fixed
     | files: supabase/migrations/0227_would_you_rather_review_fixes.sql,
     |        lib/would-you-rather/*, lib/discord.ts,
     |        app/games/would-you-rather/*, app/admin/would-you-rather/*,
     |        app/api/games/would-you-rather/*, app/games/page.tsx
     | Implementation, security, accessibility and performance reviews ran
     | independently against the shipped feature. What they found, and what
     | changed:
     | SECURITY. Ballot stuffing: resolveVoter mints a fresh guest id whenever
     | the cookie is absent, so the free-vote count was always zero for a caller
     | who simply sent none, and the only limit left was 30/min per IP. The
     | allowance is now max(cookie count, actor count) where actor is the
     | server-derived user:/ip: key, the Signal Scout shape. Verified: a loop
     | with a fresh identity per request now hits the wall on its second vote.
     | Uniqueness deliberately stays on the cookie so one office NAT is not one
     | voter. Also: the counter trigger gained an UPDATE branch, and the stored
     | webhook URL is re-validated at USE, not only when the admin form wrote it.
     | ACCESSIBILITY. Two focus bugs that stranded a screen reader entirely.
     | The reveal's focus anchor lived inside the results panel, which does not
     | render when the community graph is switched off or when the tally is
     | zero, so focus fell to body with nothing announced. Terminal states
     | returned before the live region, discarding the message they had just
     | queued. Now: one live region above every branch, every error announces,
     | and focus moves to a REAL panel heading via Panel headingFocusable rather
     | than an sr-only clipped box that gave a sighted keyboard user an
     | invisible focus ring. Also fixed: the outcome was announced twice (focus
     | + live region); the vote button's aria-label hid its own "Recording your
     | vote" state; prefers-reduced-motion was read one commit late so the bars
     | painted full, snapped to zero, then animated up; the losing bar measured
     | 1.46:1 and the vote button's edge 2.2:1; the role-ids error was not
     | associated with its field AND blur wiped the text the error named; the
     | admin poll table could not be scrolled from the keyboard; Save disabled
     | itself on success and dropped focus.
     | CORRECTNESS. The "no Positional WAR curves" banner was inferred from
     | which players matched, so it told a league that HAS curves it had none,
     | and said the same when an admin had simply hidden the block. Now an
     | explicit leagueHasWarCurves: true/false/null. formatNotice was computed
     | and dropped, so a trade graded in a substituted format printed a
     | confident margin with nothing saying the format was not the league's.
     | The value bar guessed a direction on a neutral verdict (winnerSide null
     | fell to the else branch) and showed Team B ahead every time. The Discord
     | body's blank-line filter ate every paragraph break. And the vote route
     | told a reader "nothing was recorded" when the vote HAD been recorded and
     | only the reveal failed; it now degrades to the tally.
     | PERFORMANCE. The same trade was graded twice per round (page, then vote
     | seconds later) for a result that depends on nothing about the reader:
     | about 15 round trips and 70ms of database time, wasted. The grade is now
     | cached on the pool row with a one-hour TTL. Three measured index fixes:
     | league_transactions(type,status,id) took the pool sampler's count from
     | 96.8ms to 17.2ms and its window from 118.0ms to 2.2ms;
     | players((external_ids->>'sleeper')) took mapSleeperPlayers from 27.4ms to
     | 0.10ms on EVERY Signal Check grade site-wide; and the serving index now
     | matches the query it was named for. growPool coalesces concurrent callers
     | and backs off 60s after a fruitless pass, so a thin pool cannot make every
     | render pay for it. The admin's Discord total was an unbounded select that
     | PostgREST truncates at 1000.
     | Also: dead fields removed (assetKeys, teamCount, changePct30d,
     | positionRank, startupPick.season), retireTradeAction wired into a
     | "recently served" list instead of sitting unused, guest_limit_reached
     | moved from 401 to 403, and the ellipsis character and two middle dots
     | replaced per the punctuation rule.
     | verified: yes (2,876 tests green, typecheck and build clean, punctuation
     |           and Positional WAR naming guards clean, stuffing loop refused,
     |           trigger UPDATE branch proved with begin/rollback, grade cache
     |           and actor keys confirmed populated, test votes cleaned up)

T-WYR-03 | completed | Draft pick pricing: a 14 day window, and the last known order carried forward
     | files: lib/signal-check/values.ts, lib/league-pick-position.ts,
     |        lib/signal-check/copy.ts, lib/would-you-rather/round.ts
     | Two changes to how picks get priced, both in shared Signal Check code, so
     | they land on /tools/signal-check, the League Pulse transactions feed, the
     | player-profile trades tab and Would You Rather alike.
     | THE WINDOW. draft_pick_values is a diary: the nightly sync ADDS a row per
     | pick per day and never overwrites, so after 94 days one season+round
     | carries 282 rows and a trade touching four combinations pulled 1,128 to
     | read six numbers. A query with no limit is silently capped at 1,000 by
     | PostgREST, so how many snapshots came back was a function of how much
     | history existed rather than of the trade. It was never wrong, because
     | captured_at desc puts today's rows first, but it was one ordering change
     | away from being wrong with no error anywhere. Now bounded to 14 days,
     | with a fallback to the unbounded query when the window returns nothing,
     | so a sync outage longer than the window cannot strip every pick out of a
     | trade instead.
     | THE CARRY. A pick for season S is ordered by S-1's finish, so a 2028 pick
     | had nothing to read and fell to the whole-round blend. It now inherits
     | the newest order we hold, for ONE season, then stops: team strength
     | regresses and a finish carried four years would be a guess wearing a
     | read's clothes. Early against late is about 22% of a first, so this is a
     | far larger source of error than the blend it replaces.
     | The first version of the carry read only Power Pulse projections and
     | fired for almost nobody, because plenty of leagues order picks from a
     | PUBLISHED DRAFT instead. The two sources sit on different axes (a draft
     | is keyed by the season it drafts for, a projection by the season whose
     | standings set the order) and orderFor() now collapses them so the carry
     | cannot mix them up.
     | Measured across 60 pooled trades: 2028 picks went from 0 slotted and 23
     | blended to 18 slotted and 1 blended; 2026 and 2027 went to zero blended;
     | 2029 correctly stays blended, being past the carry.
     | COPY. The game board now reads "Draft pick (early)" rather than
     | "Draft pick (mid, projected)" or "Draft pick, slot unknown". The slot
     | stays because early against late is real information for the call being
     | made; the bookkeeping goes, because a reader is judging a trade and not
     | our slotting method. The full label and its footnote still sit at the
     | bottom of the Signal Check verdict AFTER the vote, which is where an
     | audit belongs. Signal Check's own surfaces are untouched.
     | verified: yes (2,876 tests green, typecheck and build clean, measured
     |           against 60 real pooled trades before and after)

---

# Redraft parity, draft grades and the post-draft handoff (RD-T###)

Plan: `docs/redraft-and-draft-grades-plan.md`. Started 2026-08-31.

```
RD-T001 | completed | Guard playoff_week_start = 0 in the On The Clock week window
     | files: lib/on-the-clock/pulse-service.ts, lib/on-the-clock/draft-pulse.test.ts
     | depends on: none
     | verified: yes

RD-T010 | completed | Re-measure fallback variance on the startable range only
     | files: scripts/measure-position-variance.ts, docs/redraft-and-draft-grades-plan.md
     | depends on: none
     | verified: yes
RD-T011 | completed | Scoring-aware fallback variance (ppr / half / std)
     | files: lib/power-pulse/default-settings.ts, lib/power-pulse/project.ts, lib/power-pulse/validate.ts
     | depends on: RD-T010
     | verified: yes
RD-T012 | completed | Rank-aware fallback variance
     | files: lib/power-pulse/project.ts, lib/power-pulse/variance.test.ts
     | depends on: RD-T011
     | verified: yes
RD-T013 | completed | Honour playoff_round_type in the bracket simulation
     | files: lib/power-pulse/simulate.ts, lib/power-pulse/load.ts, lib/power-pulse/simulate.test.ts
     | depends on: none
     | verified: yes

RD-T020 | completed | Waiver replacement level per position from the free-agent pool
     | files: lib/on-the-clock/waiver-replacement.ts (+ test)
     | depends on: none
     | verified: yes
RD-T021 | completed | Draft Pulse scores an unfilled slot at waiver replacement
     | files: lib/on-the-clock/draft-pulse.ts, lib/on-the-clock/pulse-service.ts
     | depends on: RD-T020
     | verified: yes
RD-T022 | completed | Construction component measures scarcity, not emptiness
     | files: lib/on-the-clock/draft-grade.ts (+ test)
     | depends on: RD-T021
     | verified: yes
RD-T023 | completed | Surface the assumption in copy so the reader knows it was made
     | files: app/tools/on-the-clock/draft-grades.tsx
     | depends on: RD-T022
     | verified: yes

RD-T030 | completed | leagueEmphasis helper: wins-first vs value-first from league type
     | files: lib/league-emphasis.ts (+ test)
     | depends on: none
     | verified: yes
RD-T031 | completed | Format-aware draft grade weights
     | files: lib/on-the-clock/draft-grade.ts, lib/on-the-clock/default-settings.ts, lib/on-the-clock/types.ts
     | depends on: RD-T030
     | verified: yes
RD-T032 | completed | League Pulse rankings table leads with Pulse in redraft
     | files: app/leagues/[sleeper_league_id]/*
     | depends on: RD-T030
     | verified: yes
RD-T033 | completed | Trade surfaces lead with wins in redraft
     | files: components/trade-verdict.tsx or equivalent
     | depends on: RD-T030
     | verified: yes
RD-T034 | completed | Value labelled as leverage, not score, in redraft
     | files: as found
     | depends on: RD-T030
     | verified: yes

RD-T040 | completed | Do not emit the dynasty-only award in redraft
     | files: lib/on-the-clock/awards.ts (+ test)
     | depends on: none
     | verified: yes
RD-T041 | completed | Retire First to Fill Starting Roster
     | files: lib/on-the-clock/awards.ts
     | depends on: RD-T040
     | verified: yes
RD-T042 | completed | Most Reliable Roster gated on a spread worth reporting
     | files: lib/on-the-clock/awards.ts
     | depends on: RD-T040
     | verified: yes
RD-T043 | dropped | Most Successful Trader reads in wins in a redraft league
     | files: none
     | depends on: RD-T030
     | verified: n/a
     | why: a trade IS a value exchange, in every format. The redraft complaint
     |      was that value leads when judging TEAM QUALITY, not that a trade
     |      should be scored in wins. Re-scoring it would also mean running the
     |      full trade-impact model once per historical trade to fill a card,
     |      which trade-history.ts documents as the reason it uses the board
     |      projection instead. Nothing to change.
RD-T044 | completed | New award: Best Value Pick of Each Round
     | files: lib/on-the-clock/awards.ts
     | depends on: RD-T040
     | verified: yes
RD-T045 | completed | New awards: Most Balanced and Most Top Heavy
     | files: lib/on-the-clock/awards.ts
     | depends on: RD-T040
     | verified: yes
RD-T046 | completed | New award: Bye Week Nightmare
     | files: lib/on-the-clock/awards.ts, lib/on-the-clock/draft-pulse.ts
     | depends on: RD-T021
     | verified: yes
RD-T047 | completed | New award: Zigged When They Zagged
     | files: lib/on-the-clock/awards.ts
     | depends on: RD-T040
     | verified: yes
RD-T048 | completed | New award: Best Late Round Haul
     | files: lib/on-the-clock/awards.ts
     | depends on: RD-T040
     | verified: yes
RD-T049 | completed | New award: Toughest Schedule Drafted
     | files: lib/on-the-clock/awards.ts
     | depends on: RD-T040
     | verified: yes
RD-T050 | completed | New award: Positional WAR Winner
     | files: lib/on-the-clock/awards.ts
     | depends on: RD-T040
     | verified: yes
RD-T051 | completed | Award icons and accents for every new award
     | files: app/tools/on-the-clock/rankings-awards.tsx
     | depends on: RD-T044..RD-T050
     | verified: yes
RD-T052 | completed | Bump AWARDS_VERSION and keep old snapshots readable
     | files: lib/on-the-clock/awards.ts, lib/on-the-clock/snapshot-types.ts
     | depends on: RD-T051
     | verified: yes

RD-T060 | completed | Post-draft terminal state on the recommendation screen
     | files: app/tools/on-the-clock/panel.tsx, app/tools/on-the-clock/states.tsx
     | depends on: none
     | verified: yes
RD-T061 | completed | Draft summary tiles from the frozen snapshot
     | files: app/tools/on-the-clock/draft-complete.tsx
     | depends on: RD-T060
     | verified: yes
RD-T062 | completed | League Pulse handoff card with what the tool offers next
     | files: app/tools/on-the-clock/draft-complete.tsx
     | depends on: RD-T060
     | verified: yes
RD-T063 | deferred | What changed since your draft, from the projection vintage
     | files: app/tools/on-the-clock/draft-complete.tsx
     | depends on: RD-T062
     | verified: no
     | state: the UI is built and tested, and the prop is wired as `null`, so the
     |        banner never renders. What is missing is the COUNT: comparing the
     |        reader's players against snapshot.projection_snapshot_date to find
     |        the ones whose injury designation moved since. Needs a small server
     |        read; deliberately not faked with a placeholder number.
RD-T064 | completed | Accessibility pass on the new state
     | files: as above
     | depends on: RD-T063
     | verified: yes

RD-T070 | completed | Sub-agent review: implementation (9 findings, 7 fixed, 2 documented)
RD-T071 | completed | Sub-agent review: security (2 findings, both fixed)
RD-T072 | completed | Sub-agent review: accessibility (4 findings, all fixed)
RD-T073 | completed | Sub-agent review: performance (1 finding, fixed)
```

## Review outcomes, 2026-08-31

Four sub-agents reviewed the uncommitted build. Sixteen findings, thirteen fixed
in this session, three carried:

FIXED (high): positional shares did not sum to one, because waiver fills landed
in the weekly total but in no position bucket. The most waiver-dependent roster
therefore won the Contrarian award mechanically. Waiver points are now attributed
to the signed player's position.

FIXED (high): the balance metric filtered out positions scoring zero, which
cannot tell "this league has no kicker slot" from "this team has an empty tight
end slot". The team with the biggest hole won Most Balanced. Now measured over
the positions the LEAGUE starts, derived from the room.

FIXED (medium): the award id `positional-war-winner` violated the absolute
CLAUDE.md naming rule in code, not just in copy. Renamed to `scarcity-read`.
`lib/positional-war/naming.test.ts` does not cover `lib/on-the-clock/`, which is
why nothing caught it.

FIXED (medium): `buildWaiverPool` was rebuilt per team per week, 168 times for a
twelve-team league instead of 14. Hoisted into a per-week map.

FIXED (medium): the admin award toggle list still carried the retired award and
none of the seven new ones, so they were unswitchable. Now typed `AwardId`, so
the next one that lands without a toggle is a build error.

FIXED (medium): dead `computeStartingRosterCompletion` work ran on every call
after the award it fed was retired.

FIXED (low, security): the migration's access-matrix comment claimed
`on_the_clock_draft_snapshots` was service-role only. It has a public SELECT
policy (migration 0121). Corrected, with a note for anyone adding a private
column there.

FIXED (a11y): the region was still announced as "Who to pick" after the draft
ended, visible only to a screen reader. The available-player pool still rendered
under "Your draft is complete". The rankings caption appended a verbless fragment
that contradicted its own ordering claim. Caption and column header wording
disagreed.

DOCUMENTED, not fixed: the variance anchors are measured under the three
canonical scoring bases while the placement points are the league's literal
scoring, so a six-point-passing-touchdown league flattens quarterbacks onto the
elite figure. Bounded, same direction for every team in a league, and only
affects the fallback path. The fix is to normalise placement points to the
canonical base before reading the curve.

DOCUMENTED, not fixed: `sync-power-pulse-settings.ts` reads then writes with no
compare-and-swap, so an admin saving mid-run loses that save.

DOCUMENTED, not fixed: the `redraftWeights` back-compat guard in draft-grade.ts
is dead, because the validator always defaults the field. Comment corrected to
say what actually happens.

---

# League Activity (the league's own record of what happened)

Session of 2026-09-01. Plan: the layman's writeup in the session transcript.
Tasks prefixed `LA-T###`. Nothing committed.

```
LA-T001 | completed | Migration 0235: league_activity table, RLS, four indexes
     | files: supabase/migrations/0235_league_activity.sql
     | verified: yes (pg_policies confirms public SELECT + service_role ALL)

LA-T002 | completed | Regenerate database types via MCP
     | files: lib/database.types.ts
     | depends on: LA-T001

LA-T003 | completed | Event and card shapes, kind/category maps
     | files: lib/league-activity/types.ts

LA-T004 | completed | Sleeper setting, scoring and slot names in English
     | files: lib/league-activity/labels.ts

LA-T005 | completed | The pure diff: lineups, settings, roster slots, people, drafts
     | files: lib/league-activity/diff.ts, lib/league-activity/diff.test.ts
     | depends on: LA-T003, LA-T004
     | verified: yes (30 tests)

LA-T006 | completed | Snapshot read-before-write, and the event writer
     | files: lib/league-activity/record.ts
     | depends on: LA-T005

LA-T007 | completed | Project transactions and finished matchups into events
     | files: lib/league-activity/project.ts, lib/league-activity/project.test.ts
     | depends on: LA-T003
     | verified: yes (15 tests)

LA-T008 | completed | Extract normalizeDraftPicks to a leaf to break an import cycle
     | files: lib/sleeper-draft-picks.ts, lib/league-pulse.ts

LA-T009 | completed | Wire detection into pulseLeagueCore (snapshot before upsert)
     | files: lib/league-pulse.ts
     | depends on: LA-T006

LA-T010 | completed | Wire projection into pulseLeagueDerived as a parallel stage
     | files: lib/league-pulse.ts
     | depends on: LA-T007

LA-T011 | completed | Event to card, reusing the relay's voice module
     | files: lib/league-activity/writeup.ts, lib/league-activity/writeup.test.ts
     | depends on: LA-T003
     | verified: yes (55 tests, including a banned-punctuation scan of source)

LA-T012 | completed | Shared Sleeper player lookup, replacing a third private copy
     | files: lib/sleeper-player-lookup.ts, lib/league-transactions-data.ts

LA-T013 | completed | The paginated read, the day-window ladder, the filters
     | files: lib/league-activity/load.ts
     | depends on: LA-T011, LA-T012

LA-T014 | completed | Card component: rails, icon tiles, columns, moves, changes, stats
     | files: components/league-activity/activity-card.tsx,
     |        components/league-activity/activity-visuals.ts

LA-T015 | completed | Filter chips as links (aria-current, no client JS)
     | files: components/league-activity/activity-filters.tsx

LA-T016 | completed | The panel: scroll region, empty states, load-more footer
     | files: components/league-activity/activity-panel.tsx
     | depends on: LA-T014, LA-T015

LA-T017 | completed | Panel on the league overview, above the power rankings
     | files: app/leagues/[league_id]/page.tsx
     | depends on: LA-T016

LA-T018 | completed | Full page at /leagues/[id]/activity, plus the nav entry
     | files: app/leagues/[league_id]/activity/page.tsx,
     |        components/league-shell/nav-items.ts
     | depends on: LA-T016

LA-T019 | completed | Sub-agent review: security
LA-T020 | completed | Sub-agent review: accessibility
LA-T021 | completed | Sub-agent review: implementation
LA-T022 | completed | Sub-agent review: performance
```

## League Activity review outcomes, 2026-09-01

Four sub-agents reviewed the uncommitted build: security, accessibility,
implementation, performance. Thirty-eight findings. Everything at high or medium
severity is fixed; the rest are fixed or documented below.

FIXED (high, correctness): a failed Sleeper `/users` request returns `[]`, which
the diff read as every manager leaving at once, writing a dozen permanent false
cards. Same shape for `/rosters`, and for a snapshot whose child read errored
(which wrote "manager joined" for everyone instead). `diff.ts` now gates each
half on its own data being present, and `captureLeagueSnapshot` fails closed on a
read error. CLAUDE.md already carried this rule for Power Pulse.

FIXED (high, correctness): `league_matchups.is_final` is stamped at write time as
`week < currentWeek`, and the sync only refetches the current week onward, so it
is false forever for any normally synced league. Results would have stayed empty
all season. Finality is now derived at projection time from the league's own
`settings.leg`, which also fixes a manager who starts nobody scoring 0.0 and
swallowing their opponent's win.

FIXED (high, correctness): the projector was a sibling of the transaction sync
inside the same `Promise.all`, so it raced the writes it reads. A cold league's
first view showed a log with no moves in it. The two are now a sequential pair.

FIXED (high, performance): `resolveSleeperPlayers` put an indexed `eq` and a
leading-wildcard `slug.like` in one `or()`, which made the whole filter
unindexable and sequentially scanned the 48 MB players table on the league
overview: 161 ms and 4,106 buffers per 100 ids, measured. Split into the same two
passes `lib/player-trades.ts` already uses, chunks now parallel.

FIXED (high, performance): `league_transactions` had no `(league_id,
created_at_sleeper)` index, so the projector's overlap read planned as a bitmap
whose second leg scanned every transaction on the site inside a 7-day window.
Migration 0236 adds it: 22.8 ms and 1,948 rows becomes 0.17 ms and 27.

FIXED (high, performance): the steady state issued `ON CONFLICT DO NOTHING` for a
week of already-stored rows on every sync (641 dedupe-key probes against 119
rows). The gate now reads the window's existing keys in the same wave and writes
only what is new. Activity stage: 328 ms to 237 ms, and zero writes.

FIXED (high, a11y): the disabled filter chip's state lived in an `aria-label` on
a bare span, which maps to role=generic where naming is prohibited, so every
browser discarded it. Now visually hidden text.

FIXED (high, a11y): every card announced itself twice, once as the article's
`aria-label` summary and again as its contents. Cards are named by their own
heading now and `ariaLabel` is gone from the type.

FIXED (high, a11y): card titles were h4 under an h2 panel, skipping h3. The level
is threaded from the panel.

FIXED (medium, security): `?ateam=` was parsed on `Number.isFinite` alone, so
`?ateam=99999999999` overflowed int4 and 500'd the whole league overview.
`parseRosterId` clamps it, and both pages share the one parser.

FIXED (medium, correctness): a commissioner-executed trade was flattened to one
roster, so the card attributed one team's drops to the other. Any move touching
two rosters is stored two-sided now.

FIXED (medium, correctness): the matchup gate keyed on the highest recorded week,
so a week that became readable late was skipped forever. It keys on which weeks
are missing.

FIXED (medium, a11y): `truncate` clipped player names, team names, handles and
stat labels that had no other home on the card. All wrap.

FIXED (medium, a11y): filter and team chips were 32px against the project's 44px
floor; the load-more link dropped `rank` and `picks`, silently re-sorting the
rankings table; the skeletons were `aria-hidden` with nothing in their place; the
scroll container was `role="group"` rather than a `region` landmark; "Everything"
and "All teams" failed WCAG 2.5.3 Label in Name; the avatar alt repeated the team
name beside it; a 40-card feed had no skip link past its 80 tab stops.

FIXED (medium, perf): `/activity` awaited the whole derived pass to get one stage
of it; the snapshot re-read a `leagues` row the caller already had; the `Intl`
formatters in `lib/datetime.ts` were rebuilt per call (65 ms per 600, measured).

FIXED (low): the unused GIN index on `roster_ids` dropped (zero scans, and the
planner correctly declines it); dedupe uniqueness moved to `(league_id,
dedupe_key)` so the guarantee is structural rather than string-prefixed; the
`roster_positions` normalisers differed between the two snapshot sides; an
unrecognised Sleeper transaction type deep-linked to an empty list; a result
could read "in 2 days"; a truncated full page was a dead end.

FIXED (tests): 21 added, covering the empty-array guards, roster churn, clock
skew, the whole matchup grouper, multi-roster moves and unknown types. Three
tautological assertions replaced.

DOCUMENTED, not fixed: `commissioner_change` cannot fire, because Sleeper gives
no commissioner signal and `upsertLeagueUsers` writes the flag as false. The
branch is inert by design and `record.ts` says so.

DOCUMENTED, not fixed: `league_activity` has no retention prune. At 10,000
leagues that is roughly 5 M rows and 2 to 3 GB, which is a storage bill rather
than a latency problem, because every read is prefixed by `league_id`. A single
delete on the existing nightly job when it matters.

DOCUMENTED, not fixed: `team_identity_change`, `manager_left` and
`roster_owner_change` retain a manager's PREVIOUS handle and team name after they
change, and the table is publicly readable. Every value was public while it was
current, and the card is meaningless without it, but it is retention the rest of
the sync does not perform.

DOCUMENTED, not fixed: bursts are not grouped. Eight free agent moves in an
afternoon is eight cards. `lib/league-relay/waiver-run.ts` already solves this
shape for Discord.

---

# The FF Beacon Projection Engine (PE-T###)

Plan of record: `docs/projection-engine-plan.md`. Started 2026-09-01.

Goal: stop shipping Sleeper's projection with four multipliers on it and start
shipping our own, measured against Sleeper's on the same graded weeks. Ships
disabled behind `settings.beaconProjections.enabled` so nothing on the site
changes until the scoreboard earns it.

Conventions inherited: every migration applies via MCP, saves SQL to
/supabase/migrations/, carries its RLS policies in the same file, is verified
against pg_policies plus anon and authenticated role simulations, and regenerates
/lib/database.types.ts. Every lib task ships its colocated *.test.ts. Progress and
handoff are updated after every task.

## Phase 0 - Records
PE-T000 | completed | Plan of record written from the session audit, with every
       measurement, algorithm, schema change, settings key and source
     | files: docs/projection-engine-plan.md
     | verified: yes (research only; no code)
PE-T001 | completed | progress.md and handoff.md seeded for this build
     | files: progress.md, handoff.md
     | verified: yes

## Phase 1 - Opponent strength
PE-T010 | completed | Migration 0237: nfl_defense_vs_position gains
       adjusted_points_allowed_per_game, adjusted_multiplier, shrunk_multiplier
     | files: supabase/migrations/0237_defense_splits_opponent_adjusted.sql, lib/database.types.ts
     | notes: columns only, nullable with no default, so a null says "the calc has
       not run since 0237" rather than asserting a neutral 1.0. multiplier keeps its
       raw audit-trail meaning. Applied via MCP, types regenerated and prettier-formatted.
     | verified: yes (RLS: relrowsecurity true, exactly 2 pre-existing policies intact
       (select_public to anon+authenticated, service_role_all); anon SELECT returns
       1728 rows; anon UPDATE changed 0 rows; three new columns present in
       information_schema and in database.types.ts; npx tsc --noEmit clean)
PE-T011 | completed | lib/projections/adjust.ts, iterative opponent adjustment, pure
     | files: lib/projections/adjust.ts, lib/projections/adjust.test.ts
     | notes: adjustForOpponents (alternating ratings, 4 passes), clampMultiplier,
       shrinkMultiplier. The ordering rule (build the whole new D map from the current
       O map, THEN the new O map from the NEW D map) is pinned by a test that also
       asserts the in-place variant would give a different answer.
     | verified: yes (19 tests; tsc clean; punctuation scan clean)
PE-T012 | completed | lib/calculate-defense-splits.ts writes the new columns
     | files: lib/calculate-defense-splits.ts
     | notes: the offense on the other side of each game comes from the preserved
       Sleeper payload key "team", verified 100% populated on every regular season back
       to 2021 with 32 distinct teams. Pulled through PostgREST as a single JSON key
       rather than selecting the whole metadata object, which would drag about a
       kilobyte per row across 40,000 rows a season to read a three character code.
       Syntax verified live against the project before use.
       A bucket with no offense still counts toward the RAW allowance and is excluded
       from the adjustment only, so a future ingestion gap degrades rather than
       silently dropping games from one side of the ledger. generosity_rank now ranks
       on the ADJUSTED figure, because the raw order answers which defense had the
       easiest schedule, which is not the question the rank is labelled with.
     | verified: yes (tsc clean; ran against production, 1728 rows across 2025, 2024,
       2023 in 23s)
PE-T013 | completed | lib/projections/defense-seasons.ts + opponentMultiplier walks
       usable seasons most recent first and applies shrunk_multiplier
     | files: lib/projections/defense-seasons.ts, lib/projections/defense-seasons.test.ts,
       lib/power-pulse/project.ts, lib/power-pulse/load.ts, lib/power-pulse/project.test.ts
     | notes: the old code indexed positionally, so seasons[0] took currentSeasonWeight
       (0.7) whether or not it was the current season. It now walks candidates most
       recent first and takes the first two that EXIST and clear minGamesSampled, which
       reproduces the old preseason answer exactly while letting the live season take
       the 0.7 slot from about week 8. No date check anywhere. DefenseRow gained
       adjustedMultiplier and shrunkMultiplier; the reader takes the shrunk value and
       falls back to the raw one, gated on settings.opponent.useAdjusted.
     | verified: yes (10 new tests in power-pulse/project.test.ts, which had no test
       file at all before; 4 in defense-seasons.test.ts; tsc clean; full suite green)
PE-T014 | completed | Replace the five hardcoded [season-1, season-2] call sites
     | files: lib/league-power-pulse.ts, lib/positional-war/load.ts,
       lib/faab/league-faab.ts, lib/breakdown/league-impact.ts, lib/league-schedule/data.ts,
       lib/on-the-clock/projection-board.ts, lib/faab/outlook.ts, lib/trade-impact/load.ts,
       lib/positional-war/upgrade.ts, lib/breakdown/load-extras.ts
     | notes: TEN call sites, not five. The audit found five by reading the Power Pulse
       path; a grep for the pattern found four more (faab/outlook twice, trade-impact/load,
       positional-war/upgrade, breakdown/load-extras) plus the on-the-clock local helper,
       every one carrying the same bug. A stale comment in breakdown/load-extras claiming
       Power Pulse blends the two seasons before the current one was corrected rather
       than left to mislead the next reader.
     | verified: yes (tsc clean; full suite green)
PE-T015 | completed | Settings: opponent.positionReliability, priorGames, useAdjusted
     | files: lib/power-pulse/default-settings.ts, lib/power-pulse/validate.ts,
       lib/power-pulse/validate.test.ts, app/admin/power-pulse/power-pulse-settings-manager.tsx
     | notes: modelVersion bumped pp-5 to pp-6, so every cached Power Pulse and
       Positional WAR row is stale by definition and rescores on next view.
       positionReliability merges one level deep like injury.multipliers and
       variance.defaultCv, so a partial admin save cannot drop a position. Admin form
       gained a toggle, a prior-games field and one field per position, all through the
       existing labelled Field and Toggle components.
     | verified: yes (validate bounds tested: 0 to 1 per position, priorGames 0 to 100,
       useAdjusted boolean; tsc clean; full suite green)
PE-T016 | completed | Recalculate live and measure the adjusted year-over-year
       correlations, then set positionReliability from them
     | files: lib/power-pulse/default-settings.ts
     | notes: MEASURED, two season pairs, all 32 teams, PPR, raw and adjusted:
                  raw 25/24  adj 25/24  raw 24/23  adj 24/23   mean
         DEF        0.319      0.276      0.297      0.238     0.283
         RB         0.243      0.269      0.285      0.356     0.288
         TE         0.152      0.223      0.247      0.032     0.164
         K          0.147      0.113      0.026      0.079     0.091
         QB         0.107      0.043     -0.117     -0.075    -0.011
         WR        -0.097     -0.056     -0.027     -0.081    -0.065
       Final coefficients are the mean of all four, floored at zero: DEF 0.28, RB 0.29,
       TE 0.16, K 0.09, QB 0.00, WR 0.00. Pooling all four rather than the adjusted pair
       alone is deliberate: with 32 teams the standard error on any one of these is about
       0.19, so no two cells in a row are distinguishable and picking the flattering one
       would be fitting noise.
       HONEST FINDING: the opponent adjustment clearly helped running backs (0.264 to
       0.313) and did nothing measurable anywhere else; team defense reads slightly WORSE
       adjusted. It is kept regardless, because it removes a bias we can demonstrate
       exists and a correctness fix does not need a correlation to justify it. Saying it
       rescued the other positions would be inventing a result.
       QB went to 0.00 against published work that puts it at 0.26 (4for4). Our figure is
       the top ONE startable quarterback performance per game, clamped, which is a far
       noisier quantity than a season points-allowed rank. The disagreement is recorded
       in the settings comment so raising it is an informed admin choice.
     | verified: yes (recalculated live; applied multiplier spread is now DEF sd 0.041
       range 0.959 to 1.052, RB sd 0.028, TE sd 0.019, K sd 0.009, QB and WR exactly
       1.000, against a raw spread of sd 0.13 to 0.19 pinned at the 0.80 and 1.25 bounds.
       A 15% swing on noise is now a 5% swing on measured signal.)

## Phase 2 - Market signal
PE-T020 | completed | Migration 0238: nfl_game_odds + RLS
     | files: supabase/migrations/0238_nfl_game_odds.sql, lib/database.types.ts
     | notes: unique on (source, season, season_type, week, home_team) because a team
       plays at most one home game a week, which is exact and provider-independent.
       home_spread negative means home favoured. Implied totals stored, not derived on
       read, so a null input yields a null total rather than a confident half of nothing.
       metadata jsonb preserves the ESPN competition object per the source-preservation rule.
     | verified: yes (RLS: relrowsecurity true, exactly 2 policies
       (nfl_game_odds_select_public SELECT to anon+authenticated,
       nfl_game_odds_service_role_all ALL to service_role); anon SELECT succeeds;
       anon INSERT blocked, 0 forged rows; types regenerated, 123 tables)
PE-T021 | completed | lib/nfl-odds.ts, ESPN scoreboard adapter, WSH to WAS alias
     | files: lib/nfl-odds.ts, lib/nfl-odds.test.ts
     | notes: ESPN quotes its spread relative to the FAVOURITE named in the details
       string, not to the home team, so parseHomeSpread parses that string, falls back
       to the favorite booleans, and returns null rather than guessing a sign. A sign
       error here would silently invert every game script in the model and never show up
       in a total, so all four orientations are pinned by tests. getEspnScoreboard
       returns null on a failed request and an empty array on a genuine empty answer,
       per the project rule that a failed request is not evidence.
     | verified: yes (19 tests including a 32-code alias identity check against
       lib/nfl-teams.ts; tsc clean)
PE-T022 | completed | lib/sync-nfl-odds.ts + scripts/sync-nfl-odds.ts + npm script
     | files: lib/sync-nfl-odds.ts, lib/sync-nfl-odds.test.ts, scripts/sync-nfl-odds.ts,
       package.json
     | notes: refreshes the current week plus two ahead, because lines move but a week
       already played is not worth refetching. Upserts on the unique key, preserves the
       ESPN competition object in metadata verbatim.
       FAILURE POSTURE, corrected after first delivery: a run where EVERY targeted week
       FAILED now throws, so recordCronRun marks the ledger entry an error and cron-health
       alerts. The first version returned ok true, which made a total ESPN outage
       indistinguishable from a healthy run for as long as it lasted. A partial failure
       still returns ok true with failedWeeks populated, and an all-empty run still
       returns skipped true, because that is the dead-months case and is correct.
     | verified: yes (3 tests covering all-failed, some-failed and all-empty; tsc clean;
       full suite 3458 tests green)
PE-T023 | completed | /api/cron/sync-nfl-odds + vercel.json + cron-runs registry
     | files: app/api/cron/sync-nfl-odds/route.ts, lib/cron-runs.ts, vercel.json
     | notes: 0 13 * * *, once daily. The registry entry, the vercel.json entry and the
       CronJobName union are cross-checked by the existing cron-runs, cron-health and
       derived-tables-scheduled tests, all of which pass.
     | verified: yes (full suite green)
PE-T024 | completed | lib/projections/volume.ts, implied totals into volume and script
     | files: lib/projections/volume.ts, lib/projections/volume.test.ts
     | notes: environmentEffect returns volume, scoring and rushShift. Scoring moves on
       a doubled exponent because a richer environment produces more touchdowns per
       play, not only more plays. A NEGATIVE spread means favoured and a favourite runs
       more, so the sign flip is deliberate and pinned by a test; a sign error there
       would invert every game script and never show up in a total.
       A missing line returns EXACTLY 1 on both multipliers. A missing line is an
       adjustment we did not make, never a neutral game we asserted.
       The agent found and fixed a real edge case: with the default totalWeight of 0.5
       the scoring exponent is an integer, so a negative ratio produced a finite but
       nonsensical result that slipped past the non-finite guard. Now guarded on the
       ratio itself being positive.
     | verified: yes (17 tests; tsc clean)
PE-T025 | completed | Backfill 2026 odds and verify against the live board
     | notes: ran against production. 272 games across all 18 weeks of 2026, 272 with a
       game total and 271 with a spread. Arithmetic spot-checked against the board:
       LAC hosting ARI at a 46.5 total and -10.5 spread stores 28.5 home and 18.0 away,
       which is exactly total/2 minus and plus spread/2. Home implied totals average
       23.75 against 22.06 away, the size of home field advantage, which is the
       sanity check that the sign convention is right way round league-wide.
       Team codes stored as ours: WAS, not ESPN's WSH.
     | verified: yes

## Phase 3 - Our own projections
PE-T030 | completed | lib/projections/types.ts + default-settings.ts + validation
     | files: lib/projections/types.ts, lib/projections/default-settings.ts,
       lib/power-pulse/default-settings.ts, lib/power-pulse/validate.ts
     | notes: written by the orchestrator rather than delegated, because every other
       Phase 3 module depends on this contract and two agents writing against a moving
       one would drift. Settings live under beaconProjections inside the Power Pulse
       document for the same reason Positional WAR's do: a model that reuses the
       projection stack must not be able to run under a half-applied edit across two
       documents. enabled defaults to FALSE, so the whole build lands without changing
       a number on the site.
       Validation bounds chosen so a bad save degrades rather than breaks: blend weights
       are unit-bounded so we can never claim more than the whole projection, and
       calibration slopes cap at 1.5 because a slope above 1 would EXPAND a spread every
       measurement says is already too wide.
     | verified: yes (tsc clean; power-pulse suite green)
PE-T031 | completed | lib/projections/usage.ts, recency-weighted role shares
     | files: lib/projections/usage.ts, lib/projections/usage.test.ts
     | notes: recencyWeight, computeUsageShares, computeEfficiencyRates. Team
       denominators use the MAXIMUM off_snp on a team-week (the quarterback in almost
       every case) and the SUM of targets, carries and attempts. Every rate is a
       weighted ratio of weighted sums, never a mean of per-game ratios, so a two-target
       game cannot carry the same weight as a twelve-target one.
       DECISION on gp <= 0 rows: excluded from a player's own numerator everywhere,
       INCLUDED in team denominators, because a denominator is a team aggregate and an
       inactive player's row can only add zeros to a sum or fail to beat the snap max.
       KNOWN SIMPLIFICATION: a past season's within-season decay is measured from an
       assumed 18 week finish, which slightly overstates recency for 2020's 17 week
       season. Documented in the file.
     | verified: yes (26 tests; tsc clean)
PE-T032 | completed | lib/projections/convert.ts, opportunity to a stat line
     | files: lib/projections/convert.ts, lib/projections/convert.test.ts
     | notes: shrinkRate plus toStatLine. The model is the ASYMMETRY of the two priors:
       shares shrink with a prior of 4 weighted games because a role persists, efficiency
       with 24 because touchdown rate, yards per carry and yards per target all revert.
       A null rate omits its key rather than writing a zero, because an omitted key and a
       zero key are different claims.
       bonus_rec_te DECISION: we DO emit it on TE lines, equal to the reception count,
       whenever rec is present. scoreStatMap is a pure dot product with no
       position-specific logic, so a TE premium league whose scoring carries
       bonus_rec_te would read our line as lacking the key, contribute zero, and lose the
       entire premium, while Sleeper's own line (which carries it) prices correctly. That
       is a silent, position-specific mispricing of every TE premium league. Pinned by a
       test asserting the delta between a plain PPR map and a TE premium map equals
       0.5 * receptions, plus a companion test that non-TE positions never emit the key.
     | verified: yes (part of 49 tests across convert, calibrate and blend; tsc clean)
PE-T033 | completed | lib/projections/calibrate.ts, per-position spread calibration
     | files: lib/projections/calibrate.ts, lib/projections/calibrate.test.ts
     | notes: applied as a uniform scale across every value in the stat line rather than
       to a point total, so the line stays internally consistent (receptions times yards
       per reception still equals yards). gp is explicitly NOT scaled: it is a count of
       games, not a quantity of production, and 0.83 games is meaningless.
     | verified: yes (tsc clean)
PE-T034 | completed | lib/projections/blend.ts, beacon and sleeper per stat key
     | files: lib/projections/blend.ts, lib/projections/blend.test.ts
     | notes: ONE-SIDED KEY DECISION: a key present on only one side is carried through
       at its full asserted value regardless of weight, never blended against an implied
       zero and never dropped. Blending Sleeper's real pass_sack against our unstated
       zero would invent a claim we never made; dropping our rec_tgt because Sleeper does
       not carry it would throw away real information. Pinned at weights 0, 0.5 and 1 so
       the passthrough is shown to hold independent of weight.
     | verified: yes (tsc clean)
PE-T035 | completed | lib/projections/engine.ts, computeBeaconProjections, pure
     | files: lib/projections/engine.ts, lib/projections/types.ts
     | notes: written by the orchestrator because it is the seam every delegated module
       meets at. Mirrors EVERY Sleeper row rather than only the ones we can improve: a
       reader on the ffbeacon source reads only ffbeacon rows, so a week we declined to
       write would simply vanish, and a vanished week is indistinguishable from a bye.
       Availability is CARRIED THROUGH from Sleeper, never asserted by us.
       TWO REAL BUGS FOUND BY VERIFYING AGAINST PRODUCTION RATHER THAN BY READING:
       (1) Every kicker and defense came out 0.00, across 1,119 rows. The engine was
       re-deriving points from the stat line under canonical scoring, and canonical
       scoring has no keys for fgm or pts_allow. Even for the four modelled positions
       the re-derivation was wrong: a live 2026 quarterback row dot-products to 20.36
       while Sleeper publishes 23.26, because Sleeper scores keys the canonical map does
       not. Fixed by anchoring on Sleeper's PUBLISHED total and applying our model as a
       delta, so at blend weight 0 our row is byte-identical to Sleeper's in all three
       bases.
       (2) Calibration was inflating the deep bench by 54% at tight end. Compressing 130
       tight ends toward the top-18 mean pulls every bench player UP toward a startable
       number. The published slopes were fitted among starters, so calibration now
       applies inside the startable range only and everyone below keeps their number.
       Also carries red zone leverage: a back who takes more of his team's red zone work
       than of its carries overall scores more per carry, bounded 0.5 to 1.75 because the
       ratio is a quotient of two small numbers and runs away without a bound.
     | verified: yes (tsc clean; verified against production, see PE-T038)
PE-T036 | completed | lib/build-beacon-projections.ts, the I/O half
     | files: lib/build-beacon-projections.ts, lib/projections/source-constants.ts
     | notes: loads three seasons of stats, Sleeper's rows for the window, the odds, and
       the players; writes source='ffbeacon' rows in exactly Sleeper's shape, so every
       existing reader and every league's custom scoring works on them unchanged. That
       is why the schema needed no new table.
       The stat read is deliberately NOT filtered to rostered players: the usage model
       needs a team's whole offense to build a denominator, and dropping the team-mates
       nobody projects would inflate every share left standing.
       Writes NOTHING when there are no Sleeper rows for the window. An ffbeacon source
       that exists but covers nothing would be selected by the reader and then answer
       every question with silence, which is strictly worse than not existing.
       source-constants.ts is a leaf module with no imports so the builder can name the
       source it writes without dragging in the reader's selection logic.
     | verified: yes (tsc clean; ran against production)
PE-T037 | completed | Migration 0239: source index on player_weekly_projections
     | files: supabase/migrations/0239_projection_source_index.sql
     | notes: the unique key ALREADY carried source, so no schema change was needed
       there. What was missing was an index with source as the LEADING column. Without
       it every hot projection read doubles the rows it scans and discards the moment a
       second source exists. idx_player_weekly_projections_season_week deliberately kept
       for the source-agnostic full-table walk the accuracy grader does.
     | verified: yes (index present in pg_indexes; index-only change so RLS and types
       are unaffected)
PE-T038 | completed | scripts/build-beacon-projections.ts + cron + npm script
     | files: scripts/build-beacon-projections.ts,
       app/api/cron/build-beacon-projections/route.ts, lib/cron-runs.ts, vercel.json,
       package.json
     | notes: scheduled 30 14 * * *, LAST in the day and deliberately so. It reads what
       three earlier jobs write: usage history from sync-sleeper-stats at 09:00, the
       blend partner from sync-weekly-projections at 12:00, and game environment from
       sync-nfl-odds at 13:00. Building earlier would build on yesterday's inputs.
     | verified: yes (ran against production: 18,508 rows for 2026 weeks 1 to 18,
       mirroring Sleeper's 18,508 exactly. 3,202 modelled from our own usage; 15,306
       mirrored (9,376 because Sleeper says the player is out or uncovered, 4,672 with
       too little history, 1,258 kickers and defenses we do not model).
       PARITY CHECK against Sleeper, per position: K and DEF differ on ZERO of 1,119
       rows, which is the mirror working. QB, RB, WR and TE share the same mean and a
       slightly compressed standard deviation (RB 5.84 to 5.71), differing on 2,266 rows
       by at most about 2 points, which is calibration compressing the startable range
       and nothing else. That is exactly right for the preseason: with no 2026 games
       played the blend weight is 0 for every player, so the ffbeacon source today IS a
       calibrated Sleeper, and it earns its own weight as games are played.
       Full cron registry, vercel.json and CronJobName cross-checks green (45 tests).)

## Phase 4 - One read path
PE-T040 | completed | lib/projections/source.ts + lib/projections/read.ts
     | files: lib/projections/source.ts, lib/projections/source.test.ts,
       lib/projections/read.ts, lib/projections/read.test.ts, lib/power-pulse/load.ts
     | notes: loadAdjustedProjections is THE single adjusted read path: it resolves the
       source, loads projections, accuracy and defense splits through the EXISTING
       power-pulse loaders rather than a second copy, computes reliability once per
       player, and runs projectPlayerWeek per week.
       loadProjections in lib/power-pulse/load.ts gained an OPTIONAL sixth `source`
       parameter, applied to both the count and the page query only when supplied.
       Omitting it is byte-for-byte the old behaviour, so every existing caller is
       unaffected and their tests pass untouched.
       A null week is absent and is not counted; a stored "out" zero IS a real week and
       is. perWeek averages over the weeks that carried a projection, never over the
       window length, so a bye does not read as a week worth nothing.
     | verified: yes (15 tests across source and read; tsc clean; full suite 3,565 green)
PE-T041 | completed | Migrate lib/trade-finder-data.ts
     | files: lib/trade-finder-data.ts
     | notes: the sharpest inconsistency in the product is closed. Trade Ideas priced a
       suggested package on a raw six-week Sleeper average while the impact verdict on
       the SAME PAGE ran the adjusted projection through a Monte Carlo. Two numbers, one
       screen, two models. loadProjectedPoints now calls loadAdjustedProjections and
       keeps its Map<string, number> return shape, so this is a change of model and not
       of interface.
       KNOWN GAP: injury statuses are not passed, because lib/league-view-data.ts never
       fetches injury_status and adding that read was out of scope. The optional
       argument is omitted, which the reader treats as everyone healthy, and both files
       say so inline.
     | verified: yes (tsc clean; full suite green)
PE-T042 | completed | Migrate lib/draft-value/build.ts
     | notes: migrated, but summing rawPoints rather than the fully adjusted points, and
       the reason is a real trap the agent caught: lib/draft-value/engine.ts ALREADY
       applies its own reliability and availability discount via adjustmentMultiplier,
       sourced independently from player_projection_accuracy. Feeding it the adjusted
       number would have double-discounted every player. Summing rawPoints is
       mathematically identical to the old sum-then-score (the dot product distributes
       over a sum) while routing through the shared reader.
     | verified: yes
PE-T043 | completed | Migrate lib/beam/projections/load.ts
     | notes: uses the FULLY adjusted points, because BEAM has no other reliability or
       availability path and so cannot double-count.
     | verified: yes
PE-T044 | completed as a deliberate NON-migration | lib/player-profile.ts stays raw
     | notes: the page says what it means. The sidebar panel reads "Projected points,
       Sleeper projections" and the weekly card headline reads "Sleeper projected
       points". Swapping our adjusted numbers in under a heading that names Sleeper
       would be dishonest, and loadProjectionsMap also GRADES Sleeper published number
       against what happened for the stats tab, which needs the real published figure.
       Both raw readers now carry an explicit PE-T044 comment so this cannot drift back
       by accident, and both are named on the guard test allow-list with that reason.
     | verified: yes
PE-T045 | completed | Migrate lib/faab/outlook.ts
     | notes: fully adjusted. FAAB's other use of accuracy (buildSignals) only reports
       beat rate and availability as narrative text and never re-multiplies the points,
       so there is no double-count. The careful existing guard about Number(null) being
       0 was preserved.
     | verified: yes
PE-T046 | completed | Migrate lib/league-relay/load.ts
     | notes: fully adjusted, using the league real scoring_settings as before.
       projectedPoints is display-only in the Discord waiver writeup downstream.
     | verified: yes
PE-T047 | completed | Guard against a module reading a projected points column raw
     | files: lib/projections/raw-column-guard.test.ts
     | notes: scans lib, app and components for the three column names, modelled on
       lib/positional-war/naming.test.ts. The allow-list carries a reason per entry and
       covers the generated types, the canonical raw loader the shared reader itself
       calls, three surfaces already adjusted through their own bespoke full-pool
       loaders, the grading scoreboard (which reads raw ON PURPOSE, to grade it), two
       market-snapshot syncs whose different table has coincidentally identical column
       names, and the PE-T044 decision above.
       A SECOND test asserts every allow-list entry still exists and still matches, so
       a stale exemption is caught rather than quietly widening the hole.
     | verified: yes (8 tests; full suite 3,606 green)

## Phase 5 - Grading
PE-T050 | completed | Migration 0240: player_projection_accuracy gains source
     | files: supabase/migrations/0240_projection_accuracy_source.sql, lib/database.types.ts
     | notes: both unique indexes re-keyed to include source, or the second source's
       rows collide with the first's on insert. Default 'sleeper' is a statement of fact:
       every existing row WAS measured against Sleeper. Also protects the existing model,
       since a shrunk_multiplier measured against one source is only meaningful applied
       to that same source.
     | verified: yes (all 5595 existing rows stamped source='sleeper'; 2 policies intact
       (select_public to anon+authenticated, service_role_all); three indexes re-keyed;
       source present in database.types.ts)
PE-T051 | completed | calculate-projection-accuracy.ts grades per source
     | files: lib/calculate-projection-accuracy.ts, scripts/calculate-projection-accuracy.ts
     | notes: every derived quantity is now computed WITHIN a source, and so is the
       positional baseline. That last part is the one that would have been a silent
       disaster: the baseline key moved from season|scoring|position to
       source|season|scoring|position, because a source's positional bias is a property
       of THAT source. Centering our projections on Sleeper's bias would have been worse
       than not centering at all. The within-season week-decay curve moved with it, so a
       source with fewer published weeks does not inherit another's decay.
     | verified: yes (full suite 3,550 green)
PE-T052 | completed | /admin/projections scoreboard
     | files: app/admin/projections/page.tsx, lib/projection-scoreboard.ts, lib/nav-tree.ts
     | notes: per source, pooled and per position: weeks graded, mean absolute error,
       mean error (bias), beat rate and an OLS calibration slope. Computed fresh per
       request from the raw tables rather than from player_projection_accuracy, whose
       figures are recency-weighted and centered for a different purpose. No new table,
       per the instruction that migrations are the orchestrator's job.
       Accessibility: one h1, a real table with caption, thead and scope on every header
       cell, tabular-nums on right-aligned numerics, overflow-x-auto so NO column is
       hidden at any breakpoint, 44px scoring-basis links with aria-current and visible
       focus rings, and a plain-language "how to read this" section. Rows under 200
       graded weeks carry a "Thin sample" badge rather than being shown with the same
       confidence as a deep row.
     | verified: yes (tsc clean; full suite green)
PE-T053 | completed | Run the grader and record the first scoreboard
     | notes: ran against production. 5,703 rows for 1,206 players.
       FIRST SCOREBOARD (PPR): sleeper MAE 4.21, bias -0.13, 17,584 graded weeks.
       ffbeacon: 0 graded weeks, which is correct and expected. We have only built 2026
       and 2026 has not been played, so there is nothing to grade yet. The scoreboard
       fills in from week 1 onward and is what promotes beaconProjections.enabled from
       false to true.
       HONEST LIMITATION, recorded rather than papered over: a retrospective backtest
       against 2025 is NOT available from this build. The usage model reads whole
       seasons, so building 2025 projections today would use the very games it is
       predicting. A naive backtest would look excellent and mean nothing. A real
       walk-forward backtest (rebuild the model week by week using only prior weeks) is
       future work and is noted in handoff.md.
       ALSO CONFIRMED: the pp-5 position centering now works. Pool means of the applied
       reliability multiplier moved from QB 0.954, WR 0.970, TE 0.983, RB 0.984 to
       0.995, 0.988, 0.989, 0.993, against a target of exactly 1.000 for an average
       player.
     | verified: yes

## Phase 6 - Horizon
PE-T060 | completed | Dynasty against redraft projection weighting in trade ranking
     | files: lib/trade-finder/rank.ts, lib/trade-finder/rank.test.ts
     | notes: HORIZON_WEIGHTS layered on top of the existing stance and strategy tables
       rather than replacing them, and horizonBucket reads isDynasty and direction off
       TeamProfile, both already threaded, so no new parameter anywhere.
       THE HARD RULE IS STRUCTURAL, NOT NUMERICAL. For an inferred dynasty rebuilder,
       scoreSuggestion sets total = tradeValueTerms directly and never adds the lineup
       or wins terms to the sum at all. There is no rebuilder row in HORIZON_WEIGHTS and
       no numeric weight for that path by design, because a weight of 0.05 is still a
       re-rank and a rebuilder has told us they do not care who wins in week 12.
       The proof is a test, not a coefficient: the rebuilder ordering is asserted
       unchanged to ten decimal places when lineupDelta and winsDelta are replaced with
       four different unrelated numbers on both candidate packages.
       DELIBERATE NON-CHANGE: an EXPLICIT "value" strategy is not caught by the hard
       rule, because a contender can pick it too and the existing STRATEGY_WEIGHTS.value
       comment argues for a small positive lineup term. Only an INFERRED rebuild (from
       Power Pulse status, no toggle pressed) gets the hard zero.
     | verified: yes (5 new tests, no existing test removed or weakened; the pinned
       arithmetic test still passes untouched because a null status lands on the even
       bucket; trade-finder suite 246 tests green)

PE-T061 | completed | Admin controls for the projection model
     | files: app/admin/power-pulse/power-pulse-settings-manager.tsx
     | notes: two sections on /admin/power-pulse: the on switch, blend cap, games to
       reach it, usage half life, efficiency prior, odds toggle and calibration toggle;
       plus the four per-position calibration slopes. Every control goes through the
       existing labelled Field and Toggle components, so labels, aria-describedby hints
       and 44px targets come for free. The copy says out loud that the feature should
       stay off until the scoreboard earns it.
     | verified: yes (tsc clean; full suite 3,598 green)

## Phase 7 - Review
PE-T070 | completed | Implementation review sub-agent
PE-T071 | completed | Security review sub-agent
PE-T072 | completed | Accessibility review sub-agent
PE-T073 | completed | Performance review sub-agent
PE-T074 | completed | Fix everything at high or medium severity


## Discovered mid-build, not on the original task list

PE-T017 | completed | modelVersion can no longer be pinned by a stored settings row
     | files: lib/power-pulse/default-settings.ts, lib/power-pulse/model-version.test.ts
     | notes: FOUND IN PRODUCTION while verifying PE-T053. The global
       league_power_pulse_settings row reads modelVersion "pp-2" while the code had
       moved through pp-3, pp-4, pp-5 and pp-6. mergePowerPulseSettings took the version
       from the stored document, so every one of those four bumps announced itself with
       the oldest name and NOTHING invalidated. The single job of modelVersion is to say
       "the model changed, rescore", and a stored row is by definition older than the
       code it is merged into.
       Fixed with effectiveModelVersion: the base always comes from CODE, and the stored
       document's own shape is folded in as a short order-independent fingerprint so an
       admin edit still invalidates. Both guarantees now hold at once and a stale string
       can pin neither. modelVersion is excluded from its own fingerprint, and keys are
       sorted before hashing because Postgres does not preserve jsonb key order and a
       round-trip would otherwise look like an edit.
     | verified: yes (9 tests, including the exact stale production row as a fixture)

PE-T018 | open, needs a product decision, NOT a code change | the stale production
       settings row is also holding back two evidence-based improvements
     | notes: the same pp-2 row carries reliability.priorGames 10 and clamps of 0.85 to
       1.15. The code defaults are 60 and 0.95 to 1.05, set from the pp-5 measurement
       that beat rate has NO year over year persistence (QB 0.02, RB -0.06, WR -0.03,
       TE 0.02, K -0.01, DEF 0.16). Because a stored value wins over a default, the
       plus or minus 15% noise multiplier is still live in production.
       Deliberately NOT changed from this session. Code is ours to fix; production
       configuration is the owner's. The fix is one save on /admin/power-pulse, and it
       is called out in the final report and in handoff.md.

## Projection engine review outcomes, 2026-09-01

Four independent sub-agents reviewed the finished build: implementation,
security, accessibility, performance. None of them wrote any of it. Everything
at HIGH or MEDIUM is fixed. Final state: tsc clean, 231 files, 3,628 tests
passing, production build clean, punctuation scan clean across every changed
file.

Both HIGH implementation findings were LATENT rather than live: neither was
producing a wrong number in production yet, and both would have started doing so
under conditions this build's own purpose guarantees will occur.

FIXED (high, correctness): loadAccuracy in lib/power-pulse/load.ts had no source
filter. The moment a graded ffbeacon row exists for a player, PostgREST could
return both that row and the Sleeper one with no ORDER BY, and the loop kept
whichever came back last, mixing two populations into one reliability figure.
Migration 0240's own comment names this exact failure. It reaches Power Pulse,
Positional WAR, FAAB and Trade Ideas, not just the new engine. It now takes a
source parameter defaulting to sleeper, so every legacy caller is unchanged, and
lib/projections/read.ts passes the source it actually resolved.

FIXED (high, correctness): availableProjectionSources asked "does ffbeacon have
ANY row in this window" and then routed the WHOLE window to it. One missed cron
day during the season would leave those weeks with no ffbeacon row forever, and a
later reader spanning them would silently lose them, breaking the guarantee that
switching sources can change what a number IS but never which weeks EXIST. It is
now a COVERAGE check against the Sleeper row count for the same window.

FIXED (high, correctness): lib/player-profile.ts read both sources with no
filter. Verified live: every touched 2026 player returned 34 to 36 rows instead
of 17 to 18. Worse, loadProjectionsMap keys on season and week with no tiebreak,
so once the sources diverge the beat-or-missed comparison on the stats tab would
have become nondeterministic. The file stays on the raw Sleeper read by design
(PE-T044); the source filter is what makes the heading "Sleeper projections"
literally true rather than incidentally true.

FIXED (high, performance): the projection build spent 130 of its 160 seconds in
one phase, and nobody could say which until phase timing was added. Two causes,
both now fixed and both measured:
  1. The stat read fetched EVERY position and discarded 70% in JavaScript.
     Pushed into the query with an inner join on position.
  2. The keyset walk ordered by id, which defeated the season index and made
     Postgres walk the PRIMARY KEY filtering season row by row. Measured:
     5,276 ms for one 1,000 row page, reading 8,355 disk pages to return 1,000
     rows. Migration 0242 adds (season, season_type, id) and the walk now runs
     one season at a time, because a btree can only supply an ordering when the
     leading columns are equalities.
  RESULT: stats phase 130,269 ms to 16,536 ms, total build 160 s to 34 s, from
  53% of the 300 second cron ceiling to 11%. Output byte-identical: 18,508 rows,
  3,202 modelled, 0 dropped, same mirror breakdown.

FIXED (high, performance): lib/draft-value/build.ts called the whole
loadAdjustedProjections bundle INSIDE the per-format loop. The data does not vary
by format, only the final scoring does, and the file's own header documents a
near-identical past incident in the same function. Now grouped by
(scoringType, tePremiumBonus): 10 formats collapse to 4 groups, roughly 70 to 100
queries down to 28 to 40.

FIXED (high, performance): /admin/projections paged three whole tables on every
render, uncached, roughly 140 round trips a view, with one measured page at
774 ms. Now wrapped in unstable_cache on a 24 hour TTL and tagged with
playerProjections, playerStats and playerDepth so a nightly sync busts it
immediately rather than serving a stale board for a day.

FIXED (high, correctness): missing ORDER BY on range-based pagination in four
places, three of them new. Without a stable sort Postgres can return a different
order per page and silently skip or duplicate rows; for defense splits that
understates a sample with nothing thrown. All now order by id, matching the
convention in lib/draft-tracker/board.ts.

FIXED (high, accessibility): the scoreboard table had no row headers. Every
column header carried scope="col" but the cell giving a row its identity was a
plain td, so a screen reader user navigating cell by cell heard "Mean absolute
error" and nothing saying which position they were in. Now a row-scoped header.

FIXED (medium, correctness): a player-week could be silently dropped from the
mirror. The write key came only from the players table mapping, while the
authoritative sleeper_player_id on the row being mirrored was read and then never
used. Now row-first with the players table as fallback, and any row still without
an id is counted and logged rather than skipped in silence.

FIXED (medium, correctness): the calibration factor puts the projection in the
denominator, so it runs away as the projection approaches zero. At the QB slope
against a mean near 20, a 0.2 point projection scaled by about 33. The startable
range guard covers the normal case but a THIN pool degrades the cut to the pool
minimum and lets a near-zero row through. Now an absolute 2 point floor plus a
2x factor cap.

FIXED (medium, correctness): clampMultiplier in adjust.ts and clamp in volume.ts
had no NaN guard, and clamping NaN returns NaN. A single degenerate ratio would
have been written into shrunk_multiplier and then multiplied into every
projection facing that defense. Both now return the floor.

FIXED (medium, performance): lib/projections/read.ts ran a settings read and two
count probes BEFORE checking whether the feature is enabled, on every render
across five callers, with the feature off by default. Settings first now, probes
only when enabled.

FIXED (medium, performance): migration 0239's index served the count probes but
not the row fetch, because week is a RANGE condition and sits before player_id,
and a btree cannot use a later column as an index condition once a preceding one
is range-restricted. Measured: 113 ms fetching 429 rows to keep 171. Migration
0241 adds (source, season, season_type, player_id, week). Re-measured: all five
columns as index conditions, 171 rows fetched to return 171.

FIXED (medium, accessibility): the new numeric fields stated their bounds only in
section prose, never through aria-describedby. Native min and max are not
reliably announced and there is no form element, so constraint validation never
fires either. Every new field now carries a hint.

FIXED (medium, accessibility): the Checkbox control was 20 by 20 against the
project's absolute 44 by 44 rule. Centring it inside a 44px row did not make
anything 44px tall. The label now wraps the row and carries the target.

FIXED (medium, observability): the odds cron had maxDuration 60 against three
sequential 20 second timeouts, landing exactly on the ceiling. A slow but not
dead ESPN would have Vercel hard-kill the function, and a hard kill skips the
finalize in cron-runs, leaving a "running" row stuck in the ledger forever
instead of a clean error. Now 120.

FIXED (low, documentation): three comments that would have sent a debugger to
the wrong file. convert.ts attributed share shrinkage to volume.ts when it
happens in usage.ts; default-settings.ts claimed the usage recency ladder was
shared with Power Pulse's when they are two independent settings that merely
agree today; calculate-projection-accuracy.ts claimed a source scoping that did
not exist.

DOCUMENTED, not fixed: nfl_game_odds.metadata is publicly readable and holds the
verbatim ESPN payload, per the source-preservation rule. Nothing reads it today
and the content is not attacker-influenced (a fixed server-side URL with
internally computed params), so there is no live path. The note exists so a
future consumer does not assume it is safe to render raw.

DOCUMENTED, not fixed: the settings form has no client-side range enforcement, so
an out-of-range value is only caught by the server round trip. It is announced
correctly through the live region, and it affects the whole pre-existing form
rather than this build.

DOCUMENTED, not fixed: lib/faab/outlook.ts scans player_weekly_projections twice,
once to enumerate ids and once through the shared reader. Removing it would mean
either teaching the deliberately id-list-only reader a position query, or
enumerating from players and pulling in every roster-eligible player Sleeper
never projected. Both scans sit inside the same 24 hour cache.

DOCUMENTED, not fixed: no walk-forward backtest exists. The usage model reads
whole seasons, so building 2025 projections today would use the games it is
predicting. A naive backtest would look excellent and mean nothing. This is the
highest-value next piece of work and is recorded in handoff.md.

SECURITY: no CRITICAL and no HIGH findings. RLS verified live on all four touched
tables with role simulations rolled back in a transaction: every one has
relrowsecurity true and exactly the two-policy pattern (public select, service
role all), anon reads succeed, anon writes are rejected or affect zero rows, and
migration 0240's re-keying dropped no policy. Cron auth uses the shared
constant-time bearer check and leaks nothing in its error bodies. requireAdmin
runs before any query on the new page. No user-controlled value reaches a select,
filter, order or in clause anywhere in the build.

PE-T075 | completed | Final report artifact

## The backtest, and what it says, 2026-09-01

PE-T019 | completed | Clear the stale production settings row
     | notes: diffed the stored row against code defaults programmatically before
       touching it. It differed in EXACTLY 9 values and all 9 were superseded
       measurements: the six variance.defaultCv figures (pre-pp-4 estimates,
       replaced by figures measured from our own player_stats) and the three
       reliability values (pre-pp-5, replaced by the finding that beat rate has no
       year over year persistence). Every other key in it was byte-identical to
       the code defaults, so the row carried nothing an admin had chosen.
       Set to {} rather than deleted, so the row still exists for the admin form
       to load and save into. Effective modelVersion went from "pp-6+xl59yf" to a
       clean "pp-6", which itself invalidates the caches so leagues rescore under
       the corrected settings.
     | verified: yes (re-ran the diff: 0 differences; accuracy rebuilt)

PE-T080 | completed | Walk-forward backtest of the 2025 season
     | files: scripts/backtest-projections.ts, package.json,
       lib/projections/types.ts, lib/projections/engine.ts
     | notes: the handoff said a backtest was not available. That was wrong, and
       the owner was right to push. What is not available is a NAIVE backtest.
       The honest version walks forward: for week W it hands the engine the two
       prior seasons in full plus the target season's weeks 1 to W-1 and nothing
       else, sets latestWeek to W-1 so the recency decay is measured from the last
       week we were allowed to see, and grades against week W. assertNoLookahead
       re-checks that slice on every week rather than trusting the loop, because a
       lookahead bug would not throw, it would just return a flattering number.
       BeaconProjection gained a `modelled` flag so the isolating column grades
       only rows OUR model produced. A mirrored row is Sleeper's number wearing
       our name, and scoring it as ours would credit us with his work.
       THE RESULT, and it is not the flattering one. Pooled, 2025, PPR, 6,097
       graded player-weeks on played weeks only:
                     MAE     bias    corr
         sleeper    4.116   -0.391   0.699
         blended    4.372   -0.589   0.686    6.2% WORSE
         ours alone 5.266   -0.961   0.637    clearly worse
       And it is a dose-response curve rather than noise. In week 1, where the
       blend weight is 0, blended and sleeper agree to three decimals (3.907
       against 3.908). From week 7, where the weight reaches its cap, blended runs
       about 0.35 worse every single week. The more of our model is used, the
       worse the answer gets.
       ONE POSITION ALREADY WINS: quarterbacks. Blended MAE 6.320 against
       Sleeper's 6.540, with bias cut from -2.834 to -1.232. A per-position blend
       weight is the obvious next move and was deliberately NOT taken, because one
       position beating the incumbent on one season is a lead to follow rather
       than a result to ship.
       LIMITATION, stated rather than buried: no game environment. ESPN drops the
       betting line once a game is played, so no 2025 odds are retrievable and the
       volume and game-script adjustments contributed nothing to these numbers.
       Whatever they are worth is not in this result. The backtest also grades the
       STORED projection, not the read path, so the opponent, reliability,
       availability and injury multipliers applied by projectPlayerWeek are not in
       it either, for Sleeper or for us.
     | verified: yes (npm run backtest:projections; 3,629 tests green)

PE-T081 | completed | Act on the backtest: blend default to 0
     | files: lib/projections/default-settings.ts, lib/projections/engine.test.ts
     | notes: blend.max was 0.5 on the strength of published aggregation research.
       Our own measurement overrules it: shipping 0.5 would have made the product
       6.2% worse the moment anyone enabled the feature. It is now 0, with the
       full measurement in the comment and an instruction to raise it only when a
       rerun says so.
       At weight 0 the ffbeacon source is a CALIBRATED Sleeper, which the week 1
       rows show is a hair BETTER than raw Sleeper rather than worse, so the source
       is still worth having and still worth grading. What it no longer does is
       claim a model that has not earned it.
       Two guards on the default: one test drives the blending mechanism with its
       own explicit non-zero weight, so it keeps testing blending regardless of the
       shipped value, and a second asserts that at the shipped default a modelled
       player's stored total is still Sleeper's own number. The first test had been
       reading SETTINGS.blend.max and would have silently stopped testing anything
       the day the default hit zero.
