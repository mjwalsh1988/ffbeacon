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
