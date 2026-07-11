# Signal Scout: Final Implementation Plan

Status: planning complete (Phase 0 discovery executed 2026-07-09). No build work has started.
Companion files: progress.md (atomic task list), handoff.md (session state).
This file is the Signal Scout feature plan; plan.md remains the overall project plan.

---

# Part 1: Phase 0 Findings Summary

Discovery ran as three focused subagents (live Supabase read-only queries, identity-system
exploration, stats-machinery exploration), plus five codebase-pattern reports from the prior
planning session (tools/nav/homepage, admin patterns, auth/guest/RLS, player data model,
game UIs). Everything below is verified against the live database (project cilvpyivysjxpxbudkfa)
or cited code.

## Live data coverage (read-only SQL)

- Player pool: 712 QB/RB/WR/TE players appear in `rankings` within the last 90 days
  (QB 109, RB 205, WR 262, TE 136). Within that pool: birth_date 95.2%, college 97.5%,
  years_experience 100%, height 100%, weight 100%, team 84.8% (offseason false-nulls confirmed).
- Draft data: dead. `players.draft_year/draft_round/draft_pick` are 0% populated, and Sleeper's
  payload contains no draft keys at all (confirmed by enumerating `metadata->'sleeper'` keys).
  Draft clues are impossible without a new data source.
- High school: usable. `metadata->'sleeper'->>'high_school'` covers 95.6% of the pool (681/712).
- Jersey number: usable. `metadata->'sleeper'->>'number'` covers 98.2% (699/712).
- Sleeper ID: 100% of the pool has `external_ids.sleeper` (headshots derivable via sleepercdn.com).
- Stats: 2020 through 2025 regular seasons are fully loaded (2020 weeks 1-17, 2021+ weeks 1-18;
  28k to 41k rows per season; scripts/backfill-sleeper-stats.ts actually covers 2016-2025).
  The 2020+ directive is fully supported.
- Fantasy points live at `player_stats.metadata->'stats'->>'pts_ppr'`, not a column and not the
  flat `metadata->>'pts_ppr'` path. Roughly 40-58% of skill-position weekly rows carry points
  (the rest are non-producing rows), which is normal and fine for pool players.
- Pre-existing production bug found: the `get_player_positional_finishes` RPC (migration 0118)
  reads the flat `metadata->>'pts_ppr'` path, so it currently returns 0 points and a tied finish
  of 1 for every player, every season, every scoring type (verified live against Ja'Marr Chase).
  The player-page finishes feature that consumes it is broken today. The app-side reader
  `readPoints()` in lib/player-profile.ts handles both payload shapes, which is why the stats tab
  still works. Signal Scout needs this RPC fixed (a one-line coalesce of both paths), and fixing
  it also repairs the live player page.
- Projections: the `projections` table is completely empty (0 rows). Projection clues are out of MVP.
- ADP: `player_market_snapshots` is live and current (snapshots through 2026-07-09, 362 players
  with real ADP on the latest date, roughly half the pool). Usable as a conditional clue.
- Value trends: `ffbeacon` source has the best coverage (~800 players per dynasty format, 99%+
  with `data_points_30d >= 7`), KTC covers 499 (93.6%), FantasyCalc 478 (88.1%), DynastyProcess
  is stale (0% meeting the trend threshold). Rankings position_rank data is season-level
  snapshots (season 2025, week null).

## Identity system (My Beacon / profile)

- There is no single display-name helper. The My Beacon hierarchy is duplicated inline in four
  files: `auth.users.user_metadata.display_name`, then `user_preferences.first_name` (admin
  variant joins first + last), then email local-part, then a hardcoded default
  (app/my-beacon/layout.tsx:78-85 is the canonical dashboard instance). Display name deliberately
  lives on auth metadata, not user_preferences (migration 0057 header comment).
- The edit-profile avatar is `user_preferences.avatar_path` in the private `user-avatars` storage
  bucket, read via signed URLs (1-hour TTL); the admin users table already batch-signs these.
  A separate public identity (`signals` table, public `signal-media` bucket) exists for the
  Signal creator-profile feature.
- The site-wide default avatar is components/image-with-fallback.tsx: a circular Lucide UserRound
  silhouette. Every avatar on the site routes through this component.

## Stats machinery

- Season aggregation is centralized in `aggregateSeasons()`
  (components/player-profile/stat-shaping.tsx): groups weekly `GameRow`s by season, sums the
  StatLine fields (pass/rush/rec yards, TDs, receptions, targets, carries, completions, attempts,
  interceptions, pts_ppr), counts games as weeks with `gp > 0`. The weekly-row-to-GameRow mapping
  (`toGameRow`) is duplicated in stats-tab.tsx and beacon-breakdown/load-stats.ts; points-per-game
  is computed inline in two places with no shared helper.
- `loadWeeklyStats()` (lib/player-profile.ts) loads regular-season weekly rows for one player;
  it has no season floor parameter (Signal Scout adds `.gte("season", 2020)`).
- No career-high, best-season, or multi-season superlative logic exists anywhere in the codebase;
  that is new work for lib/signal-scout.
- The positional-finishes RPC accepts a seasons array (`p_seasons`), returns
  (season, scoring, finish, total_points, players_ranked) per scoring type, regular season only,
  and is broken as noted above.

Confirmed vs uncertain: everything above is confirmed by live query or file citation. The only
judgment calls left are product preferences listed in "Remaining questions" (section 27).

---

# Part 2: Decision Answers

1. Draft year / round / pick clues: excluded from MVP entirely. 0% coverage in both the columns
   and the raw Sleeper payload; the data does not exist to build them. They return as a future
   clue pack only if a new data source lands.
2. High school: included in MVP (95.6% coverage), tier Weak Signal, generated only when present.
   Fun flavor, rarely decisive.
3. Jersey number: included in MVP (98.2%), tier Weak Signal, generated only when present.
4. Projection clues: excluded from MVP (table is empty). Re-enable via the disabled-clue
   mechanism if projections ever populate.
5. Team and position tiers: confirmed as directed. Current team is Full Scan, exact position is
   Beacon Ping, neither is ever a starter clue.
6. Stats depth: clue generation uses 2020+ regular-season data, confirmed loaded.
   Season-specific, best-since-2020, and career-high-since-2020 clues are all feasible.
7. Leaderboard identity: reuse the My Beacon hierarchy via one new shared resolver
   (lib/user-identity.ts) instead of a fifth inline copy: `user_metadata.display_name`, then
   `first_name` plus last-name initial, then email local-part, then "Scout-XXXX" (XXXX = short
   stable hash of user id) as the extreme fallback. Avatar: `user_preferences.avatar_path` via
   batched signed URLs (the admin-page pattern), falling back to the standard ImageWithFallback
   UserRound default. No new identity or avatar system is invented. One privacy caveat is flagged
   in Remaining Questions: the email local-part step is fine on the private dashboard but appears
   verbatim on a public leaderboard; recommendation is masking that step.
8. Dead-signal scoring: adopted as directed (section 5). The minimum-correct-score-of-100 rule
   is removed; no strong reason to keep it was found, and it actively conflicts with the
   burned-out design.
9. Does a 0-point correct guess reset Signal Streak? Recommendation: yes, reset it. Three
   reasons. First, the objective is decoding before the signal dies; a burned round is a failed
   objective, the same class as a skip or a fail, and the streak should measure consecutive
   successful decodes. Second, if a burned solve left the streak untouched, burning becomes a
   free safety valve: any time a player is unsure, they buy everything, solve at 0 with
   near-perfect information, and carry the streak on with zero risk. That is exactly the farming
   loop being closed. Third, it is easier to communicate: "score points, streak grows; anything
   else, it resets" has no asterisks. The Daily Scout Streak still counts the day as played.
10. Hint purchase at insufficient score: allow and clamp to 0, behind an explicit confirmation.
    When a hint's cost is greater than or equal to the available score, the UI shows a burn
    warning ("This will burn out your signal. You can still solve the round, but it cannot score
    and your streak will reset.") and the API requires a `confirmBurn: true` flag. This preserves
    the dramatic "burn the signal to see the team" decision while making accidental burns
    impossible. Purchases are rejected outright only when the score is already 0.
11. Does a burning purchase end the round? No. Hitting 0 does not complete the round; it locks
    further hints and leaves guessing open under the normal wrong-guess cap. The player can still
    chase the "Signal Found Too Late" reveal or fail out.
12. Tier purchase limits (new setting, per round): Weak Signal 4, Clear Signal 3, Beacon Ping 2,
    Full Scan 1. Analysis: without limits, 1,000 points buys up to 10 Weak Signals; with limits
    the theoretical maximum spend is 400 + 600 + 700 + 500 = 2,200, so the score always runs out
    before the limits do, a player can never reveal more than roughly 7 hints (about 10 clues
    total with starters) before burning, and "reveal every clue" is structurally impossible.
    The limits also make Full Scan feel like a single dramatic play.
13. Result-state language (exact recommendation):
    - Correct with 1+ points: headline "Signal Found", plus a "Clean Read" badge when the round
      had zero wrong guesses.
    - Correct at 0 points: headline "Signal Found Too Late", subline "The signal burned out
      before you decoded it. No points, and your Signal Streak resets."
    - Failed by wrong guesses: headline "Signal Lost", subline "Three Bad Reads. The signal is gone."
    - Skipped: headline "Signal Skipped", subline "Round closed, no score. Your Signal Streak resets."
    - Mid-round burned banner (round still active at 0): "Signal burned out. You can still name
      the player, but this round can no longer score."
14. Value-clue source and format: value clues read `player_value_trends` at a fixed combo,
    `ffbeacon` source (best coverage, ~800 players, and the clue is branded "FF Beacon value
    range") in `dynasty-ppr-sflex`, falling back per player to `ktc` when missing. This is a
    documented exception to the global source/format sync rule: a shared game must present
    identical clues for everyone. Flagged for confirmation in Remaining Questions.
15. Guest tracking: httpOnly `ffbeacon.scout_guest` UUID cookie plus salted IP hash, cap enforced
    as the max of both counts, atomic claim RPC. Nothing in Phase 0 contradicted it.
16. Admins hidden from leaderboards by default: confirmed, `hide_admin_users` defaults to true.
17. Positional-finish clues: feasible, but gated on fixing the broken 0118 RPC (coalesce the
    nested and flat metadata paths). This fix is an early roadmap task and also repairs the live
    player-page feature.

---

# Part 3: The Plan

## 1. Product overview

Signal Scout is a hidden-player guessing game. Each round the server picks a fantasy-relevant
NFL player and builds a scouting file of clues from data FF Beacon already syncs (bio fields,
2020+ weekly stats, rankings, value trends, Sleeper ADP). The player sees a premium mystery
profile card with a few starter clues revealed and the rest locked behind four hint tiers.
Every hint burns score; every wrong guess burns score. The objective is to name the player
before the signal (score) burns out. Guests get 2 rounds per ET day and are funneled to a free
account for unlimited play, saved streaks, and leaderboards. It is a pure skill game: no
gambling, betting, prizes, or paid entries of any kind.

Why it fits: it compounds the value of data we already own, requires zero new data sources,
gives the site its first retention loop (verified: no leaderboard, streak, or score system
exists anywhere in the codebase today), and extends the existing signal-themed brand language.

## 2. Naming and positioning

- Name: Signal Scout. Tagline: "Decode the profile. Find the player."
- Tier names: Weak Signal, Clear Signal, Beacon Ping, Full Scan. Locked clue: "Signal Locked".
  Outcomes: Signal Found, Signal Found Too Late, Signal Lost, Signal Skipped. A wrong guess is a
  "Bad Read"; a zero-wrong-guess win earns the "Clean Read" badge. The burned state is "Burned Out".
- First entry in the new Games area, presented as a free interactive game with a "New" pill at launch.

## 3. Full gameplay loop

1. User lands on /games/signal-scout. Server resolves identity (session, else guest cookie) and
   resumes any active round or shows the start state with streaks, stats, and a leaderboard preview.
2. Start round: server picks the target from the eligible pool, generates and stores the full
   clue set server-side, reveals 3 starter clues. The client receives only: opaque round id,
   revealed clues, locked-slot counts and remaining-purchase counts per tier, score (1,000),
   wrong-guess count, streak context.
3. Play: buy hints (tier limits and score permitting), guess via the player-search combobox, or
   skip. Wrong guesses cost 100 and fill one of three pips; the guessed player joins a visible
   "Bad Reads" ruled-out list.
4. Burnout: if score reaches 0 (hint overdraw with confirmation, exact spend, or wrong-guess
   drain), the round enters Burned Out: banner shown, hints locked, guessing still open.
5. Completion: correct guess with 1+ points (won), correct guess at 0 (solved too late), third
   wrong guess (failed), or skip (skipped). Only completion responses carry the reveal: name,
   headshot, team, position, every clue, points, streak updates.
6. Result card renders the outcome language from section 5, then "Next round". Guests completing
   their second round of the day get the signup wall instead.

One active round per identity, enforced by a partial unique index; abandoning is only possible
through skip, so streaks cannot be gamed by bailing on hard rounds.

## 4. Result states

| State | Trigger | Headline and treatment |
|---|---|---|
| New round | No active round | Hero, Start scouting CTA |
| Active | Round live, score > 0 | Full game surface |
| Burned Out (active) | Score hit 0, round incomplete | Warning banner, hints disabled, guessing open |
| Won | Correct guess, 1+ points | "Signal Found", cyan glow, points, streak +1, Clean Read badge if 0 wrong |
| Solved too late | Correct guess at 0 | "Signal Found Too Late", muted/amber tone, 0 points, streak resets |
| Failed | Third wrong guess | "Signal Lost", danger tone, 0 points, streak resets |
| Skipped | User skips | "Signal Skipped", neutral tone, streak resets |
| Guest limit | Guest at daily cap | Signup CTA card |
| Loading / Error / Unavailable | Standard | PulseLoader; league-load-error retry card; "Signal offline" card when game_enabled is false or pool below threshold |

## 5. Scoring system (dead-signal model)

- Start: 1,000. Hint costs: Weak 100, Clear 200, Ping 350, Scan 500. Wrong guess: 100.
  Max wrong guesses: 3. All admin-configurable and snapshotted per round.
- Score is clamped at 0 and never goes negative. There is no minimum-score floor (the old 100
  floor is removed).
- Correct guess with 1+ available points: awards the remaining points, counts as a won round,
  increments Signal Streak.
- Correct guess at 0: awards 0, does not count as a win for win rate or leaderboards, does not
  increment Signal Streak, resets the active Signal Streak, reveals the player, and counts toward
  rounds played and the Daily Scout Streak.
- A hint whose cost exceeds the available score may be bought only with explicit burn
  confirmation (UI warning plus `confirmBurn` API flag) and clamps the score to 0. Hints are
  rejected once score is already 0.
- Burnout never auto-completes the round; wrong guesses at 0 still count toward the 3-strike fail.

## 6. Streak system

- Signal Streak: +1 on a won round only. Reset by failed, skipped, and solved-too-late rounds.
  Hints never touch it. Feeds the Longest Signal Streak leaderboard via best_signal_streak.
- Daily Scout Streak: any completed round (won, solved late, failed, skipped) marks the ET day as
  played; consecutive ET days increment, a gap resets to 1. Display only at MVP (not a
  leaderboard; trivially farmable).
- Guests: session-scoped display only, with "Create a free account to save your streaks" copy.

## 7. Hint economy and clue limits

Per-round purchase limits (settings-configurable): Weak Signal 4, Clear Signal 3, Beacon Ping 2,
Full Scan 1. Combined with the 1,000-point budget (max theoretical spend 2,200), a player can
afford at most about 7 hints before burning out, and can never reveal the full clue file.
Purchase mechanics: tier buttons show cost and remaining purchases; a button whose cost meets or
exceeds the current score switches to a burn-warning state requiring confirmation; exhausted
tiers and burned rounds show disabled-with-reason states. This is the decision engine of the
game: every hint trades score for confidence, and overreaching kills the round's value.

## 8. Leaderboards

Login required (leaderboards.require_login, default true). Guests have no rows by construction.
Hidden users excluded; admins excluded by default (hide_admin_users default true).

| Board | Source | Rank | Tie breakers | Columns |
|---|---|---|---|---|
| Today's Top Scouts | signal_scout_daily_scores, game_date = today ET | points desc | fewer rounds, then earlier first play | Rank, Scout, Points, Rounds, Accuracy |
| All-Time Signal | signal_scout_user_stats | total_points desc | rounds_won desc, earlier first play | Rank, Scout, Total points, Wins, Win rate, Best streak |
| Longest Signal Streak | signal_scout_user_stats | best_signal_streak desc | total_points desc | Rank, Scout, Best streak, Current streak, Total points |

Win rate = rounds_won / rounds_played; solved-too-late rounds count in the denominator only.
Live indexed queries wrapped in 60-second unstable_cache; 25 rows per page via the existing
Pager pattern; pinned "Your rank" strip computed as 1 + count of strictly-better rows.

Scout identity: one new resolver, lib/user-identity.ts, encoding the My Beacon hierarchy:
`user_metadata.display_name`, then `first_name` + last initial, then email local-part, then
"Scout-XXXX" (stable hash suffix) as the extreme fallback. Avatar: `user_preferences.avatar_path`
from the private user-avatars bucket via batched signed URLs (the app/admin/page.tsx pattern),
rendered through ImageWithFallback with its standard UserRound silhouette fallback. No new
identity system; the resolver is written once and can later replace the four existing inline copies.

## 9. Guest vs logged-in rules

Guests: 2 rounds per ET day, no leaderboards, no persisted streaks. Logged-in: unlimited rounds
with full stats. Tracking: httpOnly `ffbeacon.scout_guest` UUID cookie (ffbeacon.* convention,
1-year) plus salted SHA-256 IP hash on guest rounds; the cap enforces max(cookie count, IP count)
for the ET day inside a SECURITY DEFINER claim RPC modeled on try_claim_on_the_clock_lookup
(migrations 0109/0111), so check-and-create is atomic. Raw IPs never stored.

## 10. Clue taxonomy (verified data only)

Tiers: S = starter-eligible, W = Weak 100, C = Clear 200, P = Ping 350, F = Scan 500. Every clue
generates only when its data exists for that player; coverage numbers are live-verified.

### Bio

| Clue | Tier | Form | Coverage / gate |
|---|---|---|---|
| Age range (2-year bucket) | S/W | Range | birth_date 95.2% |
| Exact age (one decimal, lib/player-age.ts) | C | Exact | Same; never drawn alongside age range as starter |
| Experience range | S/W | Range | 100% |
| Exact years of experience | C | Exact | 100% |
| Height | S/W | Exact | 100% |
| Weight | S/W | Exact | 100% |
| College | C | Exact | 97.5% |
| High school | W | Exact | 95.6%, metadata.sleeper.high_school |
| Jersey number | W | Exact | 98.2%, metadata.sleeper.number |
| Last-name initial | F | Exact | 100%; very strong, Full Scan only |

### Team and position (team-derived clues gate on team non-null, 84.8%)

| Clue | Tier | Notes |
|---|---|---|
| Conference | S/W | AFC/NFC |
| Division | C | |
| Position group | S/W | QB rounds render as "offensive skill player" or skip |
| Exact position | P | Directed decision |
| Current team | F | Directed decision; never starter |

### Stats, 2020+ regular seasons

Aggregated via loadWeeklyStats with a 2020 season floor plus the shared aggregateSeasons helper;
fantasy points read via the readPoints dual-path pattern; position-gated so clues match the
position's stat profile.

| Clue | Tier | Form |
|---|---|---|
| Last-season fantasy points range (PPR, 25-pt bucket) | S/W | Range |
| Specific season fantasy points + points per game | C | Exact, named season |
| Specific season games played | W | Exact |
| Specific season total yards range | W | Range |
| Specific season passing / rushing / receiving yards, receptions, targets, carries, TDs | C | Exact, one stat per clue, position-gated |
| Career high fantasy points since 2020 | P | Exact ("His best season since 2020: 289.4 PPR points") |
| Career high yards since 2020 | C | Exact |
| Positional finish, specific season ("Finished WR14 in 2023") | P | Exact; requires the 0118 RPC fix |
| Best positional finish since 2020 | P | Exact; same gate |
| Snap share range (season) | P | Range; 2020+ only where populated |
| Red zone usage (season attempts) | P | Exact; where populated |
| Full season stat line (composite: yards + TDs + receptions/attempts for a named season) | F | Exact |

### Value and market

Fixed combo: ffbeacon source, dynasty-ppr-sflex, per-player fallback to ktc; documented
format/source exception.

| Clue | Tier | Form |
|---|---|---|
| FF Beacon value range (500-pt bucket) | S/W | Range |
| Overall rank range | C | Range |
| 30-day value movement | P | Direction + percent; gated on data_points_30d >= 7 |
| Sleeper ADP range (2-round bucket) | P | Range; latest snapshot only (~half the pool) |

### Removed from MVP (Phase 0 verdicts)

Draft year, draft round, draft pick (0% coverage, no source), all projection clues (empty
table), route participation (no data). Worst positional finish since 2020 is also omitted: for
most of the pool it is a noisy injury-season artifact with low deductive value; revisit if
admins want it as a disabled-by-default type.

## 11. 2020+ stats clue strategy

Clue generation builds one season-aggregate bundle per target at round start: weekly rows 2020+
(regular season), mapped through the existing GameRow shape, aggregated with aggregateSeasons,
plus the finishes RPC output (2020+ array) and derived career highs. From that bundle it mints:
one "last season" headline clue candidate, one or two named-season clues (favoring the player's
most distinctive seasons: highest points and highest volume), one career-high clue, and one
finish clue. All values freeze into the round's clue rows at start, so nightly syncs never
mutate a live round. Multi-season trend clues ("three straight top-12 finishes") are deferred to
a future clue pack; single-season and since-2020 superlatives are MVP. New shared helpers to
write: season-floor stat loading, pointsPerGame (extracting the currently duplicated inline
math), and career-high derivation (verified to not exist anywhere).

## 12. Initial clue generation

- Target selection: weighted random over the eligible pool, biased toward the rankings top ~150,
  tail chance for deep cuts; excludes the identity's last 10 targets.
- The full clue file (every gated taxonomy entry, values rendered to display strings) is
  generated and stored server-side with revealed = false; the reveal flag is the only thing that
  ever changes.
- 3 starter clues, at most one per category (bio / stat / value), never exact position, never
  team, never last-name initial; conference and position group never appear together.
  A specificity budget rejects combinations that are too identifying, and a floor requires at
  least one medium-signal clue so openers are never useless.
- Pre-completion payloads contain only: round id, revealed clues, per-tier locked counts +
  remaining purchases + costs, score, wrong guesses, ruled-out list, streaks.

## 13. Hint reveal API behavior

POST /api/games/signal-scout/round/[id]/hint with { tier, confirmBurn? }. Server order:
identity + ownership (403) + round active (409); score > 0 (409 signal_burned); tier valid and
not admin-disabled (400); tier purchase limit not exhausted (409 tier_limit_reached); unrevealed
clue exists in tier (409 tier_exhausted); if cost >= score, require confirmBurn else
409 burn_confirmation_required; then atomically reveal one random unrevealed clue of the tier,
deduct cost (clamp 0), increment counters, stamp burned_out_at if the score hit 0. Returns only
{ clue, scoreAvailable, burned, hintsUsed, tierPurchasesRemaining, lockedCounts }. Rate limit
10/min per round; CSRF header required; duplicate reveals impossible by construction (only
unrevealed rows are candidates, guarded update).

## 14. Guessing system

Search: GET /api/games/signal-scout/search?q= wrapping searchFantasyPlayers (rankings-window
pool, eligible positions), returning id, name, position, team, headshot id for disambiguation;
10-result cap; round-independent so it can never leak the answer. UI reuses the
asset-autocomplete.tsx WAI-ARIA combobox.

Guess: POST /round/[id]/guess with { guessedPlayerId }. Ownership + active checks;
pool-membership validation; duplicate guess rejected free (409); wrong guess deducts 100
(clamp 0, may trigger burnout), increments count, third fails the round; correct guess completes
as won (score >= 1) or solved_late (score = 0) with the appropriate stats, streak, and
daily-score updates in one transaction, returning the full reveal.

Edge cases: duplicate names disambiguated visually (position + team + headshot in results);
retired players absent from both pools; guesses are by id so aliases/misspellings are a search
concern only; brute force is dominated by the 3-strike fail plus a 1-per-2-seconds rate claim.

## 15. Anti-cheat plan

Load-bearing rule: game tables are service-role-only under RLS; every read and write flows
through server routes returning minimal DTOs. Target id, name, image, team, position, and
unrevealed clues never exist in page props, client state, DOM, or responses until status leaves
active. Opaque UUID round ids; ownership checks on every round route; guarded status transitions
make completion idempotent (no double awards); revealed-clue tracking server-side; claim-RPC
rate limits on guest starts, guesses, hints, and search; CSRF header on mutations; burn
confirmation server-enforced; guest caps per section 9. Headshot URLs are built server-side at
reveal so the target's Sleeper id never ships early.

## 16. Player pool eligibility

- Position in eligible_positions (default QB/RB/WR/TE); rankings membership within the 90-day
  window (verified pool: 712); required fields: birth_date, years_experience, height, weight
  (drops the pool to roughly 678); minimum clue coverage: at least 3 valid starter candidates
  and 2+ generatable clues in every paid tier; not admin-hidden.
- Exclusions: K/DEF/OL/IDP (position + rankings filters), data-poor players (coverage check,
  which also naturally defers pre-camp rookies until stats or market data exist), admin-hidden
  players (signal_scout_player_overrides with note). Duplicate names need no exclusion
  (guessing is by id).
- The admin eligibility screen renders each check pass/fail per player so "why is this player in
  or out" is always answerable.

## 17. Admin area

Route app/admin/signal-scout (requireAdmin in layout and page, NAV_ITEMS entry,
server-component reads via createAdminClient, mutations as server actions). Pages:

- Overview: stat cards (total rounds, rounds today, wins, solved-too-late, failed, skipped,
  average winning score, average hints per round, burned-out rounds count); hardest players
  (lowest win rate, min 5 rounds), easiest, most guessed, most skipped; clue reveals by tier;
  recent rounds and recent guesses tables (Pager-driven, DraftSnapshotsPanel pattern).
- Integrity panel: users with frequent burnouts and repeated 0-point solves, rapid-guess
  detection (created_at deltas under 2s within a round), and unusually high search volume per
  identity per ET day (from the activity counters). Read-only surfacing; the action is the
  existing hide tools.
- Players: eligibility checks per player, hide/unhide with admin note (hidden quartet pattern),
  target-count per player.
- Users: paginated activity table, per-user drill-in, hide/unhide from leaderboards with note.
- Settings: the manager below, including reset-to-defaults that preserves game_enabled
  (mirroring the OTC reset convention).

## 18. Admin settings

Single-row JSONB table signal_scout_settings (id = 'global', service-role-only RLS, the 0106
template), Zod-validated with per-field defaults, saved via requireAdmin server actions,
snapshotted onto rounds at start:

```
{
  game_enabled: true,
  guest_play_enabled: true,
  guest_daily_round_limit: 2,
  scoring: {
    starting_score: 1000,
    weak_signal_cost: 100, clear_signal_cost: 200,
    beacon_ping_cost: 350, full_scan_cost: 500,
    wrong_guess_penalty: 100, max_wrong_guesses: 3
  },
  clues: {
    starter_clue_count: 3,
    tier_limits: { weak: 4, clear: 3, ping: 2, scan: 1 },
    disabled_clue_keys: []
  },
  pool: { eligible_positions: ["QB", "RB", "WR", "TE"] },
  leaderboards: {
    leaderboard_enabled: true, daily_enabled: true,
    all_time_enabled: true, streak_enabled: true,
    require_login: true, hide_admin_users: true
  },
  reveal: { show_player_images: true },
  future: { difficulty_mode_enabled: false, my_league_mode_enabled: false }
}
```

minimum_correct_score is gone (dead-signal model). tier_limits and the integrity thresholds are
the new additions.

## 19. Data model

All tables ship RLS policies in their own migration (auto-RLS rule). Game tables are
service-role-only; user-aggregate tables add select_own. No metadata jsonb needed
(internal/derived tables).

- signal_scout_rounds: id uuid pk; user_id / guest_id (exactly-one check); ip_hash (guest
  rounds); target_player_id fk players; status check in (active, won, solved_late, failed,
  skipped); score_available int; score_awarded int; wrong_guess_count int; hints_used int;
  tier_purchases jsonb (per-tier counts); burned_out_at timestamptz null; settings_snapshot
  jsonb; game_date date (ET); started_at, completed_at. Partial unique active-round indexes per
  identity; indexes (user_id, started_at desc), (guest_id, game_date), (ip_hash, game_date),
  (target_player_id, status).
- signal_scout_round_clues: round_id fk cascade; clue_key; tier; label; display_value;
  specificity; cost; is_revealed; reveal_order; revealed_at. Unique (round_id, clue_key); index
  (round_id, tier, is_revealed). Service-role-only (unrevealed rows are answers).
- signal_scout_guesses: round_id fk; guessed_player_id fk; is_correct; guess_number; created_at.
  Unique (round_id, guessed_player_id); indexes for admin aggregates.
- signal_scout_user_stats: user_id pk; total_points; rounds_played / rounds_won /
  rounds_solved_late / rounds_failed / rounds_skipped / rounds_burned; total_hints;
  total_wrong_guesses; current/best_signal_streak; current/best_daily_streak; last_played_date;
  hidden_from_leaderboards + hidden_reason/at/by; first_played_at; updated_at. Lazy upsert
  onConflict user_id. Indexes on total_points desc and best_signal_streak desc, partial on
  not-hidden.
- signal_scout_daily_scores: pk (user_id, game_date); points, rounds, wins, first_play_at;
  index (game_date, points desc).
- signal_scout_player_overrides: player_id pk; is_hidden; admin_note; updated_by/at.
  Service-role-only.
- signal_scout_settings: as section 18.
- signal_scout_activity_counters: pk (identity_key, action, game_date) with count and last_at;
  service-role-only; incremented by search/guess/hint routes. Powers both rate limiting
  (windowed claims via a SECURITY DEFINER try_claim_signal_scout_action RPC in the 0109/0111
  style) and the admin integrity panel's volume stats.
- RPC try_start_signal_scout_guest_round(guest_id, ip_hash, limit, game_date): atomic guest-cap
  claim.
- Migration fix (shared benefit): repair get_player_positional_finishes to read
  coalesce(metadata->'stats'->>k, metadata->>k); required for finish clues and fixes the
  currently broken player-page finishes.

Retention: keep rounds indefinitely (history is a feature); revisit pruning guest rounds older
than 90 days post-launch.

## 20. API and server functions

Route handlers under app/api/games/signal-scout/ (guests + IP limiting = route-handler territory
per codebase convention); all mutations require the x-requested-with: ff-beacon header; typed
error codes throughout.

| Route | Method | Notable behavior |
|---|---|---|
| /round | POST | Identity resolve + guest cookie mint; game_enabled; guest claim RPC; one-active-round; pool pick; clue generation. Errors: guest_limit_reached, active_round_exists, game_disabled, pool_empty |
| /round/[id] | GET | Ownership; active DTO or completed DTO with reveal |
| /round/[id]/hint | POST | Section 13 sequence incl. confirmBurn |
| /round/[id]/guess | POST | Section 14 sequence; won vs solved_late split |
| /round/[id]/skip | POST | Complete as skipped, reveal, streak reset |
| /search | GET | Sanitized q, rate claim, 10 results |
| /leaderboards | GET | board + page params, cached, your-rank strip data |
| /me/stats | GET | Authed; own aggregates |

Admin mutations are server actions (saveSignalScoutSettings, resetSignalScoutSettings,
hidePlayer, unhidePlayer, hideUser, unhideUser), each requireAdmin + createAdminClient +
revalidatePath.

## 21. Frontend UI plan (/games/signal-scout)

Server page (force-dynamic, own metadata) plus one client root with plain useState (OTC pattern;
no Zustand). Sections top to bottom, each mapped to a verified house component:

- Hero: cyan eyebrow "Games, Signal Scout", gradient-clipped tagline (signal-check hero pattern).
- Status bar: StatReadout tiles (dashboard-panel.tsx): Score (gradient mono numeral),
  Signal Streak, Daily Scout Streak, wrong-guess pips with text, guest rounds remaining.
- Mystery profile card: OTC cockpit shell with beacon hairline (on-the-clock-client.tsx:499-514);
  silhouette portrait with scanline treatment (decorative, aria-hidden, motion-reduce safe);
  dossier header with redaction bars.
- Revealed clue grid: label + mono value cells, tier-colored chips, newest clue glow (motion-safe).
- Locked slots: per-tier rows, remaining counts, costs, lock icon plus text.
- Hint controls: four tier buttons with cost pills and remaining-purchase counts; burn-warning
  confirm state when cost >= score (slide-up-dialog confirm); disabled-with-reason when
  exhausted, limit-reached, or burned.
- Burned banner: persistent alert strip in the Burned Out state.
- Guess input: asset-autocomplete combobox clone; Bad Reads ruled-out chips below.
- Score meter: gradient bar (trade-margin-graph pattern), burn point at 0 emphasized,
  sr-only summary.
- Result card: ResultHero pattern (trade-result.tsx) with the four outcome treatments from
  section 4, full clue sheet expanded, Clean Read badge, streak deltas.
- Next round CTA (bg-beacon) or guest signup card; leaderboard preview panel with routed tabs
  (league-tabs pattern); collapsible How It Works; mobile single-column with 2x2 hint grid,
  44px targets, no data hidden at any breakpoint.

## 22. Games hub and navigation

- lib/site.ts: GAMES_NAV + PRIMARY_NAV entry { label: "Games", href: "/games", children } after
  Tools; Games footer column; SEARCHABLE_TOOLS entries. Header, mobile menu, and footer render
  generically from config; the one component change is parameterizing nav-dropdown.tsx's
  hardcoded "All tools" overview label (add overviewLabel to NavItem) so Games reads "All Games".
- Dropdown: Games, then All Games, then Signal Scout.
- /games hub: ToolCard-grid page (homepage card pattern) with the Signal Scout card and a muted
  "More games are in the works" placeholder; structure trivially accepts future game cards.
  typedRoutes ordering: /games ships before the nav entry.

## 23. Homepage integration

GamesSection inserted after ToolsSection in app/page.tsx, mirroring its structure (eyebrow, h2,
"See all games" link, card grid). Card copy: name Signal Scout; description "A mystery player.
A handful of clues. Decode the scouting profile and name the player before the signal burns
out."; CTA "Start scouting"; status pill "New" (styled like the existing Default pill on
SourceCard).

## 24. Future modes (not MVP)

My League Mode (synced-roster pools plus roster/trade clues), My Roster Mode, Waiver Wire Mode,
Rookie Mode, Dynasty Sicko Mode, Daily Challenge Mode (one shared player per ET day),
position-specific modes, league-scoped leaderboards, shareable OG score cards (signal-check
freeze/share + OG route pattern, FF Beacon brand rules). Additions unlocked by future data:
draft-pedigree clue pack (needs a draft data source), projection clues (when the projections
table populates), multi-season trend clues. The schema anticipates modes via a future nullable
mode column and settings.future flags.

## 25. Testing plan

- lib/signal-scout unit tests: scoring (deductions, clamp at 0, burn boundary at exact-cost
  purchase, award-equals-remaining, no floor, solved_late at 0, fail on third wrong), hint
  economy (tier limits, burn confirmation required, hints rejected at 0), clue generation
  (position gates, data gates incl. team-null and missing high school/jersey, starter rules,
  specificity budget, disabled keys), eligibility (all checks), streaks (won increments;
  failed/skipped/solved_late reset; daily streak ET boundaries incl. DST), guest limits (cookie
  vs IP max, day rollover), guess validation (duplicates, out-of-pool, idempotent completion).
- Stats helpers: 2020 season floor, aggregateSeasons reuse, pointsPerGame, career-high
  derivation; a regression test on the fixed positional-finishes RPC (real points, no
  all-tied-at-1 output).
- API route tests: auth/ownership matrices, status guards, typed errors, 429 paths, CSRF header,
  burn-confirmation flow, won vs solved_late branching.
- RLS verification per the CLAUDE.md sequence for every migration; leaderboard tests (order,
  ties, hidden/admin exclusion, pagination, your-rank); admin action tests (reset preserves
  game_enabled, Zod rejection, audit fields); UI state-machine tests including Burned Out;
  accessibility and mobile sub-agent audits plus a manual NVDA pass.

## 26. Accessibility plan

Clue cells and locked slots carry full programmatic labels with tier and cost; one polite live
region announces reveals and score changes; result states announce via role="alert"; the
burn-confirmation dialog is the existing focus-trapped slide-up-dialog with an explicit
accessible name ("Confirm signal burnout"); entering Burned Out announces assertively once
("Signal burned out. Hints are locked. You can still guess."); wrong-guess pips and tier buttons
never rely on color; the combobox is the proven WAI-ARIA implementation; focus moves to the
revealed clue, then to result headings, per the trade-result pattern; celebrations are CSS-only
with motion-reduce fallbacks; reveal images get meaningful alt; all timestamps render through
lib/datetime.ts in America/New_York.

## 27. Remaining questions

1. Public leaderboards inherit the My Beacon hierarchy verbatim, including the email local-part
   step. Keep it verbatim (as directed), or mask that one step (first two characters plus
   asterisks) since this surface is public? Plan defaults to verbatim; recommendation is masking.
2. Confirm the fixed value-clue combo: ffbeacon source, dynasty-ppr-sflex, per-player ktc fallback.
3. The positional-finishes RPC fix also changes behavior on the live player page (from broken
   zeros to real finishes). Any reason to stage that separately from the game work? Plan assumes
   it ships early in Phase 1.
4. "New" pill vs "Beta" label at launch. Plan assumes "New".
5. Logged-in round-history page ("My rounds"): MVP Phase 5 or post-launch? Plan marks it
   optional in Phase 5.
6. Guest history is not migrated on signup at MVP. Confirm.

## 28. Final phased roadmap

SS-T### atomic tasks live in progress.md; sub-agent reviews (implementation, accessibility,
security) close each phase.

- Phase 0, Discovery: complete (this document).
- Phase 1, Database and settings: one migration per table with RLS (settings, rounds,
  round_clues, guesses, user_stats, daily_scores, player_overrides, activity_counters), claim
  RPCs, the 0118 finishes-RPC repair, types regeneration per change, lib/signal-scout/settings.ts.
- Phase 2, Core engine: lib/signal-scout eligibility, stats bundle (2020+ loaders, career highs,
  pointsPerGame), clue taxonomy and generation, scoring with dead-signal rules, streaks, round
  engine with idempotent transitions; full unit coverage.
- Phase 3, API routes: the eight public routes with identity, guest claims, rate limits, burn
  confirmation, CSRF, typed errors; route tests.
- Phase 4, Game UI: /games/signal-scout with every section and state, including Burned Out;
  accessibility pass.
- Phase 5, Leaderboards and stats: lib/user-identity.ts resolver, boards + your-rank, /me/stats,
  guest signup flow, optional round history.
- Phase 6, Admin: overview, integrity panel, players, users, settings manager.
- Phase 7, Games hub and navigation: /games, nav/footer/homepage integration, nav-dropdown
  overviewLabel parameterization.
- Phase 8, Verification and launch: end-to-end runs (guest cap, burn paths, streak rollovers),
  NVDA and mobile audits, production build, launch behind game_enabled.

---

# Part 4: No Build Completed (as of plan date)

Confirmed at planning time: no build work was performed, no migrations were created or applied,
no production files were changed, and all Supabase access during discovery was read-only SELECT.
Incidental finding worth acting on regardless of Signal Scout: the get_player_positional_finishes
RPC (migration 0118) is broken in production today and silently returns zeroed, all-tied
finishes to the player page.
