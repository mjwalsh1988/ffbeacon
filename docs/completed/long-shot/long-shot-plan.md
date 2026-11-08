# Long Shot: the daily rarity game

Status: SHIPPED 2026-11-08 (section 30 lists what shipped differently). Approved for build. Written 2026-11-07. Revised the same
day after a cold second read (section 25 lists what the second read added)
and a third read that closed the remaining gaps and added section 0.
Every owner decision in section 1 is final and confirmed by the owner on
2026-11-07, defaults included. The builder makes NO product decisions and
asks the owner NO questions; where this document is silent, the builder
follows the closest Signal Scout or Would You Rather precedent named in
section 4 and records the choice in progress.md under the task that needed
it.

---

## 0. Build agent protocol (read first, follow throughout)

1. Work the tasks in section 23 in order. One task at a time. A task is done
   when its code, its colocated test and its verification line are done.
2. After EVERY atomic task, before starting the next: update progress.md
   (the task's status, files, verified line) AND rewrite handoff.md so it
   states exactly which task is next, what is half-done if anything, and any
   command that must be re-run. A disconnect at any moment must be
   recoverable from those two files alone. Never batch these updates.
3. Do NOT commit or push while the build is in progress. When the build is
   COMPLETELY finished (every task through LS-T062 done, the device pass and
   the review closed, the full gate green), commit and push ONCE, to main
   (task LS-T063). Rules for that commit: stay on the current branch, which
   is main (never create a branch); stage every file the build touched,
   including supabase/migrations/, lib/database.types.ts, progress.md,
   handoff.md and the data/long-shot/device-pass/ screenshots; one commit,
   message in the owner's voice in the imperative, for example
   `feat(games): Long Shot, the daily rarity game`, with a short body
   listing what shipped; NO Claude, Anthropic or Co-Authored-By attribution
   of any kind, and no model name anywhere in the message; then
   `git push -u origin main`, retrying up to four times with backoff on a
   network failure. Do not amend, do not force push, do not skip hooks. If
   the push is rejected because main moved, `git pull --rebase origin main`,
   re-run the gate, and push again.
4. Do NOT ask the owner anything. If something is genuinely blocked (a
   missing credential, a migration that fails to apply), record it in
   handoff.md under "Blocked", mark the task `blocked` in progress.md, and
   continue with every task that does not depend on it.
5. Run targeted tests while iterating and the full gate at the end of each
   phase: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
   Lint must finish with zero errors and zero warnings. Run each as its own
   command; never chain shell commands.
6. Reviews: the per-task three-sub-agent workflow in CLAUDE.md is REPLACED
   for this build by the owner's instruction. First, after every build task
   through LS-T060 is complete and the gate is green, the build agent itself
   plays the game in a real browser through Claude in Chrome at four device
   widths and fixes what it finds (task LS-T060a, section 23A). Then run
   exactly ONE reviewer sub-agent, once (task LS-T061). Its brief: read this plan and every
   file the build touched, and report bugs of every kind: implementation
   against this plan, security, RLS, data integrity, accessibility against
   CLAUDE.md's rules, performance, reliability, copy and ASCII. The build
   agent then fixes every finding that is a real defect, records each fix
   (or the reason a finding was not a defect) under LS-T061 in progress.md,
   and re-runs the gate. No other reviewer sub-agents are run.
7. Every migration goes through the Supabase MCP (project
   cilvpyivysjxpxbudkfa) and is saved to supabase/migrations/ with its RLS
   in the same file, then types are regenerated to lib/database.types.ts,
   per CLAUDE.md. Read .env.local first and echo the variable names.
8. Plain ASCII in every file. No em dash, no curly quote, no ellipsis
   character, no emoji. Write a banned character as a JavaScript escape if
   one is ever required.
9. The reference project ~/Desktop/dynasty-price-check/ is not used by this
   build; nothing is ported from it.

Route: /games/long-shot. Admin: /admin/long-shot. Code: lib/long-shot/.
Task prefix in progress.md: LS-T###. Plan citation path: docs/long-shot/long-shot-plan.md.

Every character in every file this plan produces is plain ASCII. No em dash,
no en dash, no curly quote, no ellipsis character, no emoji. The ESLint
punctuation rule enforces this in source; the builder enforces it in SQL,
docs and progress.md by hand.

---

## 1. Owner decisions (final)

1. Name: Long Shot. The tracked mode is Hurry-Up. The untracked mode is Film Room.
2. Hurry-Up is the default mode and the ONLY mode with streaks, leaderboards,
   stats, tallies and the settled bonus. Film Room is practice: nothing it
   produces is tracked, ranked, counted or shown to anyone but the player.
3. The game requires an account. A signed-out visitor sees a demo of three
   fixed prompts that runs entirely in the browser against data shipped in
   code, then a sign-in call to action. The demo never touches today's puzzle,
   the player search API, or the database. Reason: a guest could otherwise
   learn today's rarest answers and then sign in and submit them.
4. No standalone domain. Nothing in this plan prepares for one.
5. Usernames shown anywhere in this game link to the user's Signal profile at
   /u/[handle] only when that profile is live (status = 'published',
   visibility = 'public', hidden = false, read from the signals table). A
   user without a live profile renders as plain text.
6. The daily reset is the Eastern calendar day (midnight America/New_York),
   the same game date Signal Scout uses.
7. Default timer: 30 seconds per prompt, 2 seconds of server grace. Both
   admin-editable.
8. A reader with two accounts can learn answers on one and play the other.
   This is accepted; the board moderation tools in section 21.1 are the
   remedy, not a technical control.
9. The Hurry-Up time limit is claimed under the WCAG 2.2.1 essential
   exception: a timed recall round is the activity, and extending one
   player's clock would change the result for everyone else on the board.
   The mode picker names the limit in words before it is encountered, and
   Film Room is the untimed way to play every prompt. There is no per-user
   extended-time setting in this build.
10. An admin who opens the "Today's room" section of the admin page has seen
    correct answers. Admin accounts are excluded from every board by default
    (`hide_admin_users: true`), and the switch stays on at launch.
11. Lone Signal bonus: 15 points per correct answer given by under 5 percent
    of the room, paid only on days with at least 20 completed Hurry-Up
    attempts. Film Room on today's puzzle opens only after the player's
    Hurry-Up is complete; before that it plays the most recent past day.
    These are the launch values; they are admin-editable afterwards.
12. Long Shot has its OWN visual language (section 18A). It does not reuse
    the dashboard Panel-and-rail layout the other two games use. It keeps
    the FF Beacon brand (dark base, purple and cyan, Geist) and nothing else
    from them. All game artwork (the mark, the field strip, the ring, the
    tiles, the podium) is SVG written in code; no raster images are
    generated or added. Player headshots and NFL team logos are the one
    exception and are WELCOME anywhere a player or team is identified: the
    combobox results, the result reveal, the room bars, the most-given list,
    the demo select's chosen player, the completion record and the boards.
    They come from the existing components/player-headshot.tsx and
    components/nfl-team-logo.tsx, decorative (`alt=""`) with the name as
    adjacent text, exactly as the rest of the site uses them.
13. The daily board's top three stand on a podium in gold, silver and
    bronze. This is a deliberate, owner-approved exception to the brand rule
    that keeps gold off the site, scoped to EXACTLY the three podium rank
    markers (the ring, the place badge and the place word). Gold never
    appears anywhere else on the page, never in the OG card, and never as a
    page accent. Every place is also printed as a word, so nothing depends
    on the color.

---

## 2. What the game is

Every player gets the same five prompts each day. A prompt is a fill-in like
"Name a running back with 100 or more rushing yards and a touchdown in one
game this season." Each prompt has many correct answers. The answer set is
computed from FF Beacon's own tables when the day is generated and stored.
Points depend on how low-profile the correct answer is: the player everyone
rosters scores 10, the one nobody rosters scores 100. After each answer the
player sees how many other people gave the same answer today. Streaks,
daily and all-time boards, and a plain-text share row give a reason to come
back tomorrow.

How it differs from the two existing games, so no reviewer calls it a
duplicate:

- Signal Scout: deduce ONE hidden player from clues; the target is a weighted
  random pick per round (lib/signal-scout/round-engine.ts selectTarget);
  unlimited rounds; guests allowed.
- Would You Rather: judge a real anonymized trade; the room's split is the
  payoff; guests allowed for a few rounds.
- Long Shot: recall MANY correct answers against a SHARED daily puzzle;
  rarity is the payoff; accounts only.

---

## 3. Vocabulary (locked)

| Word on screen | Meaning | Code identifier |
| --- | --- | --- |
| Long Shot | the game | `long-shot`, `longShot`, table prefix `long_shot_` |
| Hurry-Up | timed, tracked mode (default) | `mode = 'hurry_up'` |
| Film Room | untimed, untracked practice mode | `mode = 'film_room'` |
| prompt | one of the five questions | `prompt` |
| answer | the player chosen for a prompt | `answer` |
| tier | Chalk, Field, Deep, Sleeper, Long Shot | `tier` enum below |
| Lone Signal | the settled rarity bonus badge | `lone_signal` |
| the room | everyone who completed that day's Hurry-Up | `tally` |
| game day | the Eastern calendar date of a puzzle | `game_date` |

Tier enum, lowest to highest, with points and the one-letter share code:

| tier | points | share letter | meaning |
| --- | --- | --- | --- |
| `chalk` | 10 | C | the obvious answer |
| `field` | 30 | F | the pack |
| `deep` | 60 | D | a deeper cut |
| `sleeper` | 85 | S | few rostered him |
| `long_shot` | 100 | L | nearly nobody rostered him |
| miss (wrong or timed out) | 0 | X | not a tier; share letter only |

Maximum base score on a five-prompt day: 500 (less on a `short` day,
section 7.2). Lone Signal bonus is added on top after settlement (section 10).

---

## 4. Precedents the builder copies

When this plan says "as Signal Scout does" or "as Would You Rather does", it
means these files, and the builder reads them before writing the equivalent:

- Settings document, Zod schema, loader, clamp, admin save:
  lib/signal-scout/settings.ts, lib/signal-scout/default-settings.ts,
  lib/would-you-rather/settings.ts.
- Service-role orchestration with status-guarded writes and no transactions:
  lib/signal-scout/round-engine.ts (read its CONSISTENCY MODEL header).
- Route hardening (same-origin header guard, private JSON, zod on every
  input): lib/signal-scout/route-helpers.ts requireFfBeaconHeader,
  privateJson, uuidSchema.
- Durable per-actor rate limit from any server path: lib/rate-limit-claim.ts
  claimRateLimitSlot, which wraps the try_claim_rate_limit RPC.
- In-process request coalescing: lib/request-coalesce.ts coalesce.
- Leaderboard query layer, identity resolution, exclusion set, page-aware
  ranks, the 60-second identity cache: lib/signal-scout/leaderboards.ts and
  lib/user-identity.ts resolveUserIdentities (surface "public") and
  scoutFallbackLabel.
- Game date and consecutive-day math: lib/signal-scout/streaks.ts
  currentEasternGameDate and isConsecutiveDay (moved in LS-T001, see
  section 20).
- Player autocomplete: app/api/games/signal-scout/search/route.ts and
  app/games/signal-scout/guess-combobox.tsx (lib/player-search.ts
  underneath).
- Cron route shape: app/api/cron/would-you-rather-discord/route.ts
  (verifyCronRequest, recordCronRun, runtime nodejs, force-dynamic) and the
  time budget pattern in app/api/cron/recalculate-derived/route.ts
  (maxDuration, timeoutMs passed to recordCronRun).
- Admin page shape: app/admin/would-you-rather/page.tsx and its actions.ts
  (requireAdmin, settings manager component, service-role reads).
- Page shell: app/games/signal-scout/page.tsx (PageBody, PageMasthead,
  PageColumns, Panel, pageShareMetadata, webApplicationJsonLd).
- Copy to clipboard: components/copy-link-button.tsx (the new text copy
  button in section 14 is built from it).
- Paged reads: lib/supabase/fetch-all.ts fetchAllRows and
  fetchAllRowsInChunks, always with an order that ends on a unique column.
  Never a bare select that could exceed 1000 rows.

---

## 5. Player-facing behavior

### 5.1 Signed out

The page renders the masthead, a "How it works" panel, the demo (section 11),
and a sign-in call to action linking to `/login?next=/games/long-shot`. No
leaderboard rows are rendered for signed-out visitors (the rail shows the
boards' existence and a sentence that they are for signed-in players). No
prompt text from today's puzzle is rendered. Nothing from the database is
read except the settings row (for game_enabled).

### 5.1a Which main panel renders (signed in)

`loadPageState` decides, in this order; the first match wins:

1. An `active` attempt in either mode exists: the prompt flow (5.3), resumed.
2. Today's hurry_up attempt is `completed`: the completion panel (5.4) for
   it, with the "Replay today in Film Room" button. The mode picker is not
   shown.
3. Today's hurry_up attempt is `abandoned` (the player left it and the night
   closed it): a panel "Your Hurry-Up for today was closed unfinished. You
   scored {base} on {k} prompts. Tomorrow's puzzle is a fresh start." plus a
   Film Room button (today's puzzle is open to Film Room, because the
   Hurry-Up is over).
4. Otherwise: the mode picker (5.2).

A film_room completion shows its completion panel until the player presses
"Back" (returns to whichever of 2, 3 or 4 applies) or "Play again in Film
Room".

### 5.2 Signed in, no active attempt

The page shows:

1. The masthead with today's date in Eastern ("Puzzle for Saturday, November 7").
2. The "Yesterday" panel in the rail if the user has a completed attempt for
   yesterday's game date (section 10.4). Otherwise the panel is omitted.
3. The mode picker: two large buttons, Hurry-Up first and visually primary,
   Film Room second. Each has a two-line description. Hurry-Up: "Thirty
   seconds a prompt. Counts for streaks and the boards." Film Room: "No
   clock. Practice only; nothing is recorded." Under the picker, one sentence:
   "Film Room opens for today's puzzle once your Hurry-Up is done. Until then
   it plays a past day."
4. The leaderboard rail (section 13) and "My record" panel (section 12).

When no puzzle exists yet for today (the generate cron failed), the picker
still renders, with the sentence "Today's puzzle is being built. Press
Hurry-Up or Film Room and it will be ready in a moment." The page itself
never generates a puzzle (section 6).

When `settings.film_room_enabled` is false the Film Room button is not
rendered and its sentence is omitted.

Choosing Hurry-Up starts the attempt (section 17.2). Choosing Film Room
before today's Hurry-Up is complete starts a Film Room attempt on the most
recent PAST game date that has a puzzle (yesterday normally), and says so in
a sentence above the first prompt: "Film Room: yesterday's puzzle (Friday,
November 6). Today's opens after your Hurry-Up."

### 5.3 During an attempt

One prompt on screen at a time. Layout, top to bottom:

1. A status line: "Prompt 2 of 5", the mode name, and in Hurry-Up the clock
   (section 8.3).
2. The prompt text as an h2.
3. The player combobox (section 18.3).
4. The Answer button (disabled until a player is chosen) and, in Film Room
   only, a Skip button (scores 0, moves on) and an "End practice" button
   (sets the film_room attempt `abandoned` through POST /attempt/[id]/end,
   section 17.3a, and returns to the main panel).
5. The running base score for this attempt.

Focus moves to the prompt heading on load (section 18.1), never into the
combobox.

After an answer is submitted the result panel replaces the combobox. It is a
`<section>` with a visible h2 "Result for prompt {n}", which is the focus
target, and contains:

- One sentence: "{Player name}: {Tier word}, {points} points." For a miss:
  "{Player name} is not an answer to this prompt. 0 points." For a timeout:
  "Time ran out. 0 points." For a Film Room skip: "Skipped. 0 points."
- The room line: "{n} of {total} players gave this answer" where total is
  `answered_total` for the prompt (every Hurry-Up answer, timeouts included).
  In Hurry-Up the prefix is "Today:". In Film Room the prefix is "In that
  day's Hurry-Up room," and the figures are that puzzle's tallies. When
  total is below 5 the line reads "You are among the first to answer this
  prompt."
- "Most given so far": up to five rows, each a player name linked to his
  profile (/players/[slug]) with his tier word and the count. Only CORRECT
  answers with count >= 1 appear. This is the only place other correct
  answers are shown, and only after the player's own answer is recorded.
- A Next button. On the last prompt it reads "See your day". The next
  prompt's clock does NOT start until Next is pressed (section 8.2).

### 5.4 Completed

The completion panel (h2 "Your day", focus target) shows:

- The total for the day and the tier words in prompt order ({n} of them on a
  short day).
- The share row (section 14) with the Copy result button and a Copy page
  link button.
- In Hurry-Up: today's rank among completed attempts so far, the current
  streak, and the sentence "Lone Signal bonuses are settled overnight; check
  back tomorrow." In Film Room: "Practice round. Nothing was recorded."
- A Film Room button ("Replay today in Film Room") in Hurry-Up completion.
- The leaderboard rail and My record panel update.

Reopening the page after completion shows this panel again (read from the
stored attempt), never the prompts.

### 5.5 Resuming

An active hurry_up attempt is resumed REGARDLESS of its game date.
`loadPageState` first looks for ANY active hurry_up attempt for the user
(there is at most one, because the settle cron closes them nightly) and
resumes it; today's mode picker appears only when none exists. A player who
started at 23:58 Eastern and crosses midnight keeps their attempt, and the
masthead then says "Puzzle for Friday, November 6", the attempt's own date.
In Hurry-Up the server clock continues (section 8.2); a prompt whose time
ran out while the tab was closed is recorded as timed out when the page is
reopened and the next prompt is served. An active film_room attempt is
resumed the same way.

### 5.6 Game disabled

When settings.game_enabled is false the page renders the masthead and one
panel: "Long Shot is paused. Check back soon." Nothing else. Routes return
`{ error: "game_disabled" }` with status 503, and the client swaps to the
paused panel if this arrives mid-attempt.

---

## 6. Game day, generation schedule and settlement schedule

- `gameDate = currentEasternGameDate(now)` from lib/game-date.ts (LS-T001).
- The puzzle for game date D is generated by the cron at 17:00 UTC on D minus
  one day (that is 12:00 or 13:00 Eastern the day before). Every table it reads
  has refreshed by then: recalculate-derived 10:00 UTC, rebuild-draft-value
  15:00 UTC, sync-sleeper-stats 09:00 UTC, sync-ktc 07:00 UTC. The cron
  computes `target = addDays(currentEasternGameDate(now), 1)`.
- Inline generation, when the cron failed, runs ONLY inside
  POST /api/games/long-shot/attempt, which exports `maxDuration = 60`. It
  never runs inside a page render and never inside /state. `ensurePuzzle(admin, D)`
  is wrapped in `coalesce("long-shot:generate:" + D, ...)`. A race on the
  unique `game_date` index is read as "someone else generated it": on 23505
  the function re-reads and returns the existing row.
- Settlement for game date D runs at 05:30 UTC on D plus one day. At that
  moment Eastern time is 00:30 EST or 01:30 EDT, so D has ended in both
  halves of the year. The cron computes `target = addDays(currentEasternGameDate(now), -1)`
  and settles every puzzle with `game_date <= target` and `settled_at is null`,
  oldest first, so a missed night catches up.
- `addDays(date: string, n: number): string` lives in lib/game-date.ts and
  uses the same UTC-noon arithmetic isConsecutiveDay uses.

---

## 7. Puzzle generation

### 7.1 Output

One `long_shot_puzzles` row and up to five `long_shot_prompts` rows,
positions 1 to 5. Generation is deterministic for a given (game_date,
seed_salt, settings, data) through a seeded PRNG (`mulberry32` in
lib/long-shot/random.ts). The seed is `yyyymmdd * 31 + seed_salt`. Cron and
inline generation use `seed_salt = 0`, so a race or a retry for the same date
reproduces the same puzzle. The admin's Regenerate buttons pass
`salt = previous salt + 1` and store it on the puzzle row, so an admin who
dislikes a set gets a different draw while an unattended regenerate does not.

### 7.2 Template families

Seven families. A day uses five DISTINCT families. Selection: shuffle the
enabled families with the seeded PRNG, walk the list, instantiate each until
five prompts pass the answer-set bounds (section 7.4); if fewer than five
pass, instantiate a second parameterization of already-used families (a
different parameter draw) until five pass or every family has been tried
three times, in which case the puzzle is written with `status = 'short'`,
the prompts that passed, and the cron run reports an error. A `short` puzzle
is playable; the client shows "Prompt 1 of {n}", completion is decided at
`prompt_count` (section 16.3), and the share row has {n} letters. When ZERO
prompts pass, no puzzle row is written, the cron run reports an error, and
inline generation returns 503 `puzzle_unavailable` with client copy "Today's
puzzle could not be built. Try again in a few minutes." (the next start
attempt tries again through `ensurePuzzle`).

Each family defines: `key`, `enabledByDefault`, a parameter draw, prompt text
builder, and an answer-set query. Positions eligible everywhere: QB, RB, WR,
TE (`ELIGIBLE_POSITIONS` in lib/long-shot/types.ts). `season` means the
current NFL season from lib/nfl-season.ts currentNflSeason() parsed to a
number; `seasons` means 2020 through the current season inclusive
(`STATS_FLOOR_SEASON = 2020`).

Completed-week test (used by families 1, 2 and 6): the most recent completed
week of the current season is the maximum `week` in player_stats
(`season_type = 'regular'`) whose row count is at least 60 percent of the
row count of the week before it, or, for week 1, at least 1,500 rows. A week
under that share is in progress (one Thursday game) and the week before it
is used. The current season is eligible for any season draw only when it has
a completed week; otherwise the draw is uniform over prior seasons. The dry
run (LS-T029) prints the chosen week and both counts.

Family 1: `game_line`. Source: player_stats (regular season only,
`season_type = 'regular'`).
- Draw: position from [QB, RB, WR, TE]; season from `seasons` weighted 50
  percent current season (when eligible), 50 percent uniform over prior
  seasons; stat threshold from the position's table:
  - QB: `pass_yd >= 300`, or `pass_td >= 3`, or `rush_yd >= 50 and pass_td >= 1`.
  - RB: `rush_yd >= 100`, or `rush_yd >= 100 and rush_td >= 1`, or `rec >= 6`.
  - WR: `rec_yd >= 100`, or `rec >= 8`, or `rec_td >= 2`.
  - TE: `rec_yd >= 75`, or `rec >= 6`, or `rec_td >= 1 and rec_yd >= 50`.
- Prompt text: "Name a {position noun} who had {threshold phrase} in one game
  {in the current season | in the {season} season}." Position noun from
  lib/site.ts positionNoun. Threshold phrases: "300 or more passing yards",
  "3 or more passing touchdowns", "50 or more rushing yards and a passing
  touchdown", "100 or more rushing yards", "100 or more rushing yards and a
  rushing touchdown", "6 or more catches", "100 or more receiving yards", "8
  or more catches", "2 or more receiving touchdowns", "75 or more receiving
  yards", "a receiving touchdown and 50 or more receiving yards".
- Answer set: distinct player_id from player_stats joined to players where
  players.position = position and the thresholds hold and season matches.
  Implementation: `admin.from("player_stats").select("player_id, players!inner(position)")`
  with `.eq("season", s).eq("season_type", "regular").eq("players.position", pos)`
  plus the threshold `.gte()` filters, `.order("id", { ascending: true })`
  before `.range`, paged with fetchAllRows (the walk uses
  `idx_player_stats_season_id (season, season_type, id)` from migration 0242
  and cannot repeat a row), then de-duplicated in memory. Each query reads one
  season, because that index serves equality on season only.

Family 2: `opponent_line`. Source: player_stats.
- Draw: position from [RB, WR, TE]; opponent team code from the 32 codes in
  lib/nfl-teams.ts; season as in family 1; threshold: RB `rush_yd >= 75`, WR
  `rec_yd >= 75`, TE `rec_yd >= 50`, or for any of the three
  `rush_td + rec_td >= 1` (phrase "scored a touchdown").
- Prompt text: "Name a {position noun} who {threshold phrase} against
  {team name} {season phrase}." Team name from lib/nfl-teams.ts nflTeamName.
- Answer set: as family 1 with `.eq("opponent", code)`. Rows with null
  opponent are excluded by the filter.

Family 3: `season_finish`. Source: player_positional_finishes with
`scoring = 'pts_ppr'`.
- Draw: position; finish cutoff from [5, 12, 24] (TE: [5, 12]); season from
  `seasons` excluding the current season (the current season has no finish
  until it ends). With probability 0.4, and ONLY when the cutoff is 5 or 12,
  the phrase "in any season since 2020" unions every prior season (the
  cutoff-24 union exceeds the answer bound at every position and is never
  drawn).
- Prompt text: "Name a {position noun} who finished top {cutoff} in PPR
  scoring {in {season} | in any season since 2020}."
- Answer set: distinct player_id where position matches and `finish <= cutoff`
  and season in range.

Family 4: `market_rank`. Source: rankings (rows with the maximum
`generated_at` per (format, source)) for the site default source
(lib/source.ts getDefaultSourceSlug; today that is ffbeacon, not KTC) and
the format drawn below.
- Draw: format slug from ["dynasty-ppr-sflex", "dynasty-ppr-std", "redraft-ppr-std"]
  (only those the default source lists in source_registry.supported_format_slugs,
  or all of them when that column is null; if none, the family is skipped for
  the day); cutoff from [24, 50, 100].
- Prompt text: "Name a player ranked inside the top {cutoff} on today's
  {source display name} {format display name} board." Source display name
  from source_registry.display_name; format display name from
  format_configs.display_name. The source is named because the reader's own
  header source may differ and the same site shows other boards.
- Answer set: player_id with `overall_rank <= cutoff` in that format and
  source, restricted to ELIGIBLE_POSITIONS through a players join.

Family 5: `value_mover`. Source: player_value_trends for the default source
and format "dynasty-ppr-sflex".
- Skip rule: if the default source does not cover dynasty-ppr-sflex, or has
  no player_value_trends rows for it, the family is skipped for the day.
- Draw: direction from ["up", "down"]; window from ["7d", "30d"].
- Prompt text: "Name a player whose {source display name} dynasty superflex
  value {rose | fell} over the last {7 | 30} days."
- Answer set: player_id where `change_{window}_pct >= 5` (up) or `<= -5`
  (down), `data_points_30d >= 7`, `current_value >= 1000`, positions filtered
  through players. The 1000 floor keeps the set to players a reader could
  know; the 5 percent floor keeps noise out.

Family 6: `waiver_wire`. Source: player_roster_rates for the current season
joined to player_stats for the most recent completed week.
- Skip rule: no completed week in the current season (offseason), or no
  roster-rate season qualifies under section 7.5.
- Draw: rate ceiling from [0.25, 0.5] over `redraft_rostered / redraft_total`;
  points floor from [12, 15, 20] on `pts_ppr`.
- Prompt text: "Name a player rostered in under {25 | 50} percent of our
  redraft leagues who scored {floor} or more PPR points in week {week}."
- Answer set: player_ids with a player_stats row for that week and
  `pts_ppr >= floor`, whose roster-rate row has `redraft_total > 0` and
  `redraft_rostered / redraft_total < ceiling`. A player with no roster-rate
  row counts as rate 0 (nobody rosters him).

Family 7: `league_trades`. Source: league_transactions through the RPC in
section 16.2.
- Draw: window days from [30, 90]; league floor from [25, 50, 100].
- Prompt text: "Name a player traded in more than {floor} of our leagues in
  the last {30 | 90} days."
- Answer set: the RPC returns (sleeper_player_id, league_count); keep
  `league_count > floor`; map sleeper ids to players.id through
  players.external_ids->>'sleeper' (lib/ranking-boards.ts readSleeperId shows
  the key); restrict to ELIGIBLE_POSITIONS. Unmapped ids are dropped.

### 7.3 Prompt row fields

For each prompt: `position` 1 to 5, `template_key`, `prompt_text`, `params`
jsonb (the draw), `answers` jsonb: an array of
`{ player_id, tier, rate }` sorted by rate ascending, `answer_count`.

### 7.4 Answer-set bounds and the typeable rule

Every answer set is intersected with `longShotSearchPool` (section 17.5)
BEFORE the bounds are checked, so an answer that cannot be typed into the
combobox is never an answer. A test asserts the intersection runs (a fake
pool that excludes one id drops that id from the set).

`MIN_ANSWERS = 8`, `MAX_ANSWERS = 60`, both admin-editable per template
(settings.templates[key].min_answers, max_answers). A set outside the bounds
fails and the family redraws (section 7.2). A set over the maximum is NOT
truncated; it fails, because truncating would make a correct answer wrong.

### 7.5 Tiering

Input: the answer set with each player's `rate`. `rate` is
`redraft_rostered / redraft_total` from the most recent player_roster_rates
season whose `redraft_total >= settings.tiers.min_rate_leagues` (default
50). In March the new NFL season's rate rows exist with a handful of leagues
and would be noise, so the previous season's rows are used until the new
one qualifies. When no season qualifies, every rate is 0, the puzzle is
still written, and the generate run result notes `rates: none`. A player
with no row in the chosen season has rate 0.

Players with no roster-rate row (retired, out of the league) all tie at
rate 0 and all take the long_shot tier, however many there are. That is
intended: the question is who rosters him today, and nobody does. The dry
run prints the share of rate-0 answers per prompt so the owner can see when
a prompt is mostly retirees.

Pure function `assignTiers(answers, cutoffs, points)` in lib/long-shot/tiers.ts:

1. Sort ascending by rate, then by player_id for a stable order.
2. For index i in a set of n, `p = i / n`. Ties on rate take the p of the
   FIRST index with that rate, so equal rates always get equal tiers.
3. Tier by p: `p < 0.10` long_shot; `p < 0.25` sleeper; `p < 0.50` deep;
   `p < 0.75` field; else chalk. Thresholds are the settings
   `tiers.cutoffs = { long_shot: 0.10, sleeper: 0.25, deep: 0.50, field: 0.75 }`,
   validated strictly increasing.
4. Points by tier from settings.tiers.points (defaults in section 3).

Tiers are frozen on the prompt row. A later change to settings changes
tomorrow's puzzle, never today's.

---

## 8. Modes and the timer

### 8.1 Mode rules

- `hurry_up`: timed, one attempt per user per game date, enforced by the
  unique index `(user_id, game_date) where mode = 'hurry_up'`. Tracked
  everywhere.
- `film_room`: untimed, unlimited attempts, on today's puzzle only after the
  user's hurry_up attempt for today is `completed` or `abandoned`;
  otherwise on the most recent past game date with a puzzle
  (`select game_date from long_shot_puzzles where game_date < today order by game_date desc limit 1`).
  Never tracked: no tally increment, no stats, no streak, no board, no
  bonus. Rows are stored so the flow can be resumed and validated
  server-side. The player can end one at any time (End practice). The settle
  cron sets any film_room attempt still `active` after 24 hours to
  `abandoned`, and deletes film_room attempts older than 30 days. When
  `settings.film_room_enabled` is false, POST /attempt with mode film_room
  returns 403 `film_room_disabled`.
- At most ONE active attempt per user across both modes: starting any
  attempt while one is active returns 409 `attempt_active` (17.2).
- The Skip and End practice buttons exist only in film_room.

### 8.2 Server clock (hurry_up only)

- The answer row for a position is created in state `pending`, with
  `served_at = now()`, by the /next route and nowhere else. The
  attempt-start route serves position 1 through the same function. The
  answer response NEVER creates the next row, so a prompt's clock starts
  when the player asks for it, not while they read the previous result.
  Serving the same pending prompt again returns the same `served_at`; it is
  never reset.
- `limitMs = attempt.timer_seconds * 1000`, read from the attempt row (frozen
  at start, section 15.4). `graceMs = settings.timer.grace_seconds * 1000`,
  read live, because grace exists to absorb network latency and a change to
  it is harmless.
- On answer submit: if `now() > served_at + limitMs + graceMs` the answer is
  recorded `timed_out`, `player_id = null, tier = null, points = 0`, whatever
  the body carried. Otherwise it is scored.
- On serve-next: if the current pending prompt is past its deadline, it is
  first recorded as timed out, then the next prompt is served. If it is not
  past its deadline, the same prompt is returned with
  `remainingMs = max(0, served_at + limitMs - now())` (grace not included;
  the client never knows about grace). A client receiving 0 submits a
  timeout at once.
- Recording a timeout, whether from the answer route or serve-next, is one
  function `recordTimeout(attempt, answerRow)` that does the guarded answer
  update, the attempt advance and the tally RPC with a null player, exactly
  as a submitted answer does.
- A timed-out prompt's result panel shows the room line and the most-given
  list like any other result, because the player can no longer gain from it.

### 8.3 Client clock (display only)

- A countdown in whole seconds, as text ("24 seconds left"), beside the
  prompt number. Starts from `remainingMs` the server returned. Drives the
  Answer button: at 0 the client calls the answer action with
  `{ timedOut: true }` and no player, and focus moves to the result heading,
  which the state region announces as "Time ran out. 0 points." A reader
  typing in the combobox at that moment loses the input, which is the only
  outcome a timeout can have.
- The visible countdown is an ordinary text node, NOT aria-hidden and NOT
  inside any live region, so its every-second change is silent and it is
  still readable on demand. A separate `role="status"` region (the timer
  region) announces exactly three times: on prompt load ("Prompt 2 of 5, 30
  seconds"), at 10 seconds left, and at 5 seconds left. Nothing visible on
  the page is aria-hidden except decorative icons.
- Under `prefers-reduced-motion` there is no bar or ring; there is never an
  animated element, only the text.
- The time limit's accessibility basis is owner decision 9.

---

## 9. Scoring, tallies and the room line

- Base points per prompt: the tier's points, or 0 for a miss or timeout.
- `base_points` on the attempt is ALWAYS recomputed as the sum of `points`
  over the attempt's answer rows, never incremented, in the answer route, in
  `recordTimeout` and in the repair path (section 17.3), so no path can
  double count. `total_points = base_points` until settlement.
- Tallies: `long_shot_answer_tallies (prompt_id, player_id, count)`,
  incremented through the `long_shot_increment_tally` RPC ONLY for hurry_up
  answers with a non-null player_id, correct or not. Wrong answers are tallied
  too, so the room line can say "12 others also guessed him" on a miss; the
  most-given list shows only CORRECT answers (those present in the prompt's
  answer set).
- `answered_total` on the prompt row: incremented by the same RPC for every
  hurry_up answer including timeouts, so the denominator counts everyone who
  faced the prompt.
- Room line uses `count` for the chosen player and `answered_total` for the
  denominator.
- Contention: five row updates per answer on five hot rows is far below any
  row-lock limit at this site's traffic; no batching is needed and none is
  built.

---

## 10. Settlement and the Lone Signal bonus

### 10.1 When

The settle cron (section 17.6) on each unsettled puzzle whose game date has
ended, oldest first.

### 10.2 Abandoned attempts

Every hurry_up attempt for that game date with `status = 'active'` is set to
`status = 'abandoned'` (guarded on `status = 'active'`), its pending prompts
recorded as timed out through `recordTimeout`, `base_points` recomputed from
its answer rows. Abandoned attempts appear on no board, add nothing to stats,
and do not extend a streak. The My record panel's seven-day row shows such a
day as "closed unfinished" (letters for the answered prompts, then a dash
per unanswered one). A player still on the page gets 409 `attempt_closed` on
their next write (section 17.4). In the same pass, every film_room attempt
`active` for more than 24 hours is set `abandoned` (no timeouts are
recorded for it, because nothing about it is tracked).

### 10.3 Lone Signal (idempotent per attempt)

Only when the puzzle has at least `settings.bonus.min_room` (default 20)
completed hurry_up attempts. For each completed attempt and each correct
answer: `share = tally.count / prompt.answered_total`. If
`share < settings.bonus.lone_share` (default 0.05) the answer qualifies for
`bonus_points = settings.bonus.points` (default 15).

For each attempt, ONE guarded update:
`update long_shot_attempts set bonus_points = $b, total_points = base_points + $b, settled_at = now() where id = $id and settled_at is null returning id`.
Only when that update returns a row does the run (a) mark the qualifying
answer rows `lone_signal = true`, (b) add `$b` to
`long_shot_user_stats.total_points`, and (c) add the count of qualifying
answers to `long_shot_user_stats.lone_signals`. An attempt whose
`settled_at` is already set is skipped. When the room is under `min_room`,
every attempt still gets the guarded update with `$b = 0`, so it is marked
settled. Abandoned hurry_up attempts get the same guarded update with
`$b = 0` and no stats write. `best_day_points` counts base points only and
is not touched by settlement. The puzzle's `settled_at` is stamped only
after every completed and abandoned hurry_up attempt for the date carries a
`settled_at`. A rerun therefore finishes the remainder and pays nobody twice.

After the puzzle is stamped, the streak reset runs once:
`update long_shot_user_stats set current_streak = 0 where current_streak > 0 and last_completed_date < $target`
where `$target` is the game date just settled. A user who did not complete
that date has broken their streak, and the stored value now says so
(section 12).

### 10.4 Yesterday panel

Read from the user's completed attempt for yesterday. If settled: total,
bonus, the prompts that earned Lone Signal (prompt text and the player's
name), and yesterday's final daily rank (computed at read from the daily
board query with the yesterday date). If completed but not yet settled (the
cron failed): the base total and the sentence "Lone Signal bonuses for this
day are not settled yet." Rendered as a Panel with eyebrow "Yesterday" and
heading "Your settled day" (or "Your day, not yet settled"). Omitted when
there is no completed attempt for yesterday.

---

## 11. The demo (signed-out visitors)

- lib/long-shot/demo.ts exports `DEMO_PROMPTS`: three prompts about settled
  historical facts that cannot change, each with a hard-coded list of valid
  answer names and a tier for each, and a hard-coded candidate list of 30
  names for the demo select (the valid answers plus decoys). The builder
  writes the three prompts from the 2024 season using player_stats and
  player_positional_finishes queries run ONCE during the build and pastes the
  results as literals, with a comment naming the query and the date it ran.
  Suggested prompts: "Name a running back with 1,000 or more rushing yards in
  2024.", "Name a tight end who finished top 12 in PPR scoring in 2024.",
  "Name a quarterback who threw 30 or more touchdowns in 2024."
- The demo opens with a two-button choice identical in shape to the real
  mode picker: "With the clock" and "No clock". "No clock" is a full demo
  with no timer. The choice is made before any demo prompt is shown (WCAG
  2.2.1 for signed-out visitors, who have no Film Room).
- The demo component (app/games/long-shot/demo.tsx, client) runs in the
  browser with no network calls. The player control is a native `<select>`
  labeled "Choose a player" with the 30 candidate names as options, followed
  by the Answer button; a native select is fully keyboard and screen reader
  operable with no custom code (a native option cannot carry an image, so
  the chosen player's headshot and team logo appear in the demo's result
  reveal instead, keyed by the Sleeper ids stored beside the names in
  demo.ts). The same tier words and points, a 30-second
  visible clock in the timed branch that behaves like Hurry-Up, and a
  results sentence. Its room line reads "In the real game this line shows how
  many players gave the same answer today."
- A "Sample" badge, a heading that says "Demo: three prompts from the 2024
  season, not today's puzzle", and a lead sentence inside the demo region,
  the same words-not-styling rule the Manager Ledger empty state follows.
- The demo is rendered only when there is no signed-in user. It is never
  rendered to a signed-in user, who has the real game.

---

## 12. Streaks and stats (hurry_up only)

`long_shot_user_stats` one row per user, lazily upserted at completion:

- `days_played` (+1 per completed hurry_up attempt), `total_points` (base at
  completion, bonus added at settle), `best_day_points` (max of base points
  over completed attempts), `long_shots` (count of long_shot-tier answers),
  `lone_signals` (written ONLY by settlement), `last_completed_date`,
  `current_streak`, `best_streak`, `first_completed_at`,
  `hidden_from_leaderboards`, `hidden_reason`, `hidden_at`.
- Streak update at completion, pure function `applyCompletion(prev, gameDate)`
  in lib/long-shot/streaks.ts: if `prev.last_completed_date` is null, streak 1;
  if `isConsecutiveDay(prev.last_completed_date, gameDate)`, streak + 1; if
  equal to gameDate, unchanged (cannot happen with the unique index but is
  handled); otherwise 1. `best_streak = max`.
- The settle cron zeroes `current_streak` for everyone who missed the settled
  date (section 10.3), so the stored value is right from 00:30 Eastern.
  `displayedStreak(stats, today)` returns `current_streak` when
  `last_completed_date` is today or yesterday, else 0; it covers the hours
  between a missed day's end and the cron.
- `recordCompletion` is anchored on the attempt:
  `update long_shot_attempts set stats_recorded_at = now() where id = $id and status = 'completed' and stats_recorded_at is null returning id`,
  and the stats upsert runs only when that returned a row. `loadPageState`
  calls `recordCompletion` for any completed hurry_up attempt of the user
  with a null `stats_recorded_at`, which is how a completion whose stats
  write crashed heals on the next visit.

"My record" panel: days played, current streak, best streak, total points,
best day, Long Shot answers, Lone Signals, and the last seven days as a row of
tier letters per day (read from the user's attempts).

---

## 13. Leaderboards and Signal profile links

### 13.1 Boards

Three boards, hurry_up data only, in lib/long-shot/leaderboards.ts modeled
on lib/signal-scout/leaderboards.ts (same PAGE_SIZE 25, MAX_PAGE 200, 60
second unstable_cache, same exclusion set built from
`long_shot_user_stats.hidden_from_leaderboards` plus `user_preferences.is_admin`
when `settings.leaderboards.hide_admin_users`):

- `daily`: completed attempts for the given game date (default today),
  ordered by `total_points desc, completed_at asc`. Before settlement
  `total_points = base_points`.
- `all_time`: `long_shot_user_stats` ordered by `total_points desc,
  days_played desc, first_completed_at asc`.
- `streak`: `long_shot_user_stats` ordered by `current_streak desc,
  best_streak desc, first_completed_at asc`, one query on the index in
  15.6, correct because the settle cron zeroes broken streaks nightly.

Cache keys: the daily board keys `unstable_cache` on
`["long-shot-leaderboard", board, requestedDate]` with page as the
argument, where `requestedDate` is the `date` param or today, so yesterday's
request never serves today's rows. all_time and streak key on today's date
so they roll at midnight. The exclusion set is read OUTSIDE the cache and
passed as an argument so it is part of the key, which is what makes a hide
take effect within the TTL. Identity resolution goes through a copy of
Signal Scout's `cachedResolveIdentities` keyed `["long-shot-identities"]`.

Each row: rank, display name, avatar URL, `isYou`, the figures, and
`profileHref` (section 13.2) or null. Raw user ids never leave the module.

When `settings.leaderboards.enabled` is false the rail renders one
sentence, "Boards are paused.", and GET /leaderboards returns 503
`leaderboards_disabled`.

The rail renders page 1 of `daily` server-side and fetches other boards and
pages from `GET /api/games/long-shot/leaderboards?board=&page=&date=`, the
Signal Scout rail pattern. The your-rank strip is included.

### 13.2 Signal profile links

lib/long-shot/profile-links.ts exports
`resolveLiveProfileHandles(admin, userIds: string[]): Promise<Map<string, string>>`:
one query per 200 ids on `signals` selecting `user_id, handle` with
`.eq("status", "published").eq("visibility", "public").eq("hidden", false)`.
The leaderboard layer calls it alongside resolveUserIdentities and sets
`profileHref = "/u/" + handle` when present. The row component renders the
name as a Link when `profileHref` is non-null with `aria-label` "{name}, open
Signal profile", else as a span. This helper is written here, and a comment
in it says it is the shared implementation for any other game that wants the
same link; nothing in Signal Scout changes in this plan.

---

## 14. Sharing

Plain text, built by pure `buildShareText(tiers, basePoints, bonusPoints, gameDate)`
in lib/long-shot/share.ts:

```
Long Shot, Nov 7, 2026
C F D S L = 285
ffbeacon.com/games/long-shot
```

Line 2 is the tier letters in prompt order ({n} of them; X for a miss or
timeout) followed by the base total; after settlement a non-zero bonus
appends " +15 Lone Signal". The date is formatted with lib/datetime.ts
formatEasternShortDate on the game date at UTC noon.

The copy control is a new `components/copy-text-button.tsx` with props
`{ text, label, ariaLabel, noun }`, built from components/copy-link-button.tsx
with the href resolution removed, writing through
`navigator.clipboard.writeText` and announcing success in its own status
region. The completion panel renders it with label "Copy result" beside a
"Copy page link" from CopyLinkButton. components/share-strip.tsx is NOT used:
its payload is an image route and this game has none. The page's link
preview is the fixed card in section 19.

---

## 15. Data model

Six migrations, numbered from the next free number at build time (0363 if
nothing lands first). Each file carries the access matrix comment at the top,
`enable row level security`, every policy, and is applied through the
Supabase MCP, saved to supabase/migrations/, then types are regenerated to
lib/database.types.ts. Policy names follow `{table}_{verb}_{scope}`.

### 15.1 long_shot_settings

```
create table public.long_shot_settings (
  id text primary key default 'global' check (id = 'global'),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
```
RLS: service_role all. No anon, no authenticated.

### 15.2 long_shot_puzzles

```
create table public.long_shot_puzzles (
  id uuid primary key default gen_random_uuid(),
  game_date date not null unique,
  status text not null default 'ready' check (status in ('ready','short')),
  prompt_count integer not null check (prompt_count between 1 and 5),
  seed_salt integer not null default 0 check (seed_salt >= 0),
  generated_at timestamptz not null default now(),
  generated_by text not null check (generated_by in ('cron','inline','admin')),
  settled_at timestamptz,
  completed_attempts integer not null default 0 check (completed_attempts >= 0),
  model_version integer not null default 1
);
```
RLS: service_role all. No client policy of any kind.

### 15.3 long_shot_prompts

```
create table public.long_shot_prompts (
  id uuid primary key default gen_random_uuid(),
  puzzle_id uuid not null references public.long_shot_puzzles(id) on delete cascade,
  position integer not null check (position between 1 and 5),
  template_key text not null,
  prompt_text text not null,
  params jsonb not null default '{}'::jsonb,
  answers jsonb not null,
  answer_count integer not null check (answer_count > 0),
  answered_total integer not null default 0 check (answered_total >= 0),
  unique (puzzle_id, position)
);
```
RLS: service_role all only. The answers column is the anti-cheat boundary;
no client role ever reads this table.

### 15.4 long_shot_attempts

```
create table public.long_shot_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  puzzle_id uuid not null references public.long_shot_puzzles(id) on delete cascade,
  game_date date not null,
  mode text not null check (mode in ('hurry_up','film_room')),
  status text not null default 'active' check (status in ('active','completed','abandoned')),
  current_position integer not null default 1 check (current_position between 1 and 6),
  base_points integer not null default 0 check (base_points >= 0),
  bonus_points integer not null default 0 check (bonus_points >= 0),
  total_points integer not null default 0 check (total_points >= 0),
  timer_seconds integer,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  stats_recorded_at timestamptz,
  settled_at timestamptz
);
create unique index long_shot_attempts_one_hurry_up_per_day
  on public.long_shot_attempts (user_id, game_date) where mode = 'hurry_up';
create index long_shot_attempts_daily_board
  on public.long_shot_attempts (game_date, total_points desc, completed_at asc)
  where mode = 'hurry_up' and status = 'completed';
create index long_shot_attempts_user on public.long_shot_attempts (user_id, game_date desc);
create index long_shot_attempts_active on public.long_shot_attempts (user_id) where status = 'active';
```
RLS: authenticated SELECT own rows (`auth.uid() = user_id`); service_role
all; no client writes. `timer_seconds` freezes the limit in force when the
attempt started (null for film_room), so a settings change mid-day does not
alter a running clock.

### 15.5 long_shot_answers

```
create table public.long_shot_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.long_shot_attempts(id) on delete cascade,
  prompt_id uuid not null references public.long_shot_prompts(id) on delete cascade,
  position integer not null check (position between 1 and 5),
  state text not null default 'pending' check (state in ('pending','answered','timed_out','skipped')),
  served_at timestamptz not null default now(),
  answered_at timestamptz,
  player_id uuid references public.players(id) on delete set null,
  correct boolean,
  tier text check (tier in ('chalk','field','deep','sleeper','long_shot')),
  points integer not null default 0 check (points >= 0),
  lone_signal boolean not null default false,
  unique (attempt_id, position)
);
```
RLS: authenticated SELECT own rows through the attempt
(`exists (select 1 from long_shot_attempts a where a.id = attempt_id and a.user_id = auth.uid())`);
service_role all; no client writes. The row carries ids only; nothing on it
reveals another prompt's answers.

### 15.6 long_shot_answer_tallies and long_shot_user_stats

```
create table public.long_shot_answer_tallies (
  prompt_id uuid not null references public.long_shot_prompts(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  count integer not null default 0 check (count >= 0),
  primary key (prompt_id, player_id)
);
create table public.long_shot_user_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  days_played integer not null default 0,
  total_points integer not null default 0,
  best_day_points integer not null default 0,
  long_shots integer not null default 0,
  lone_signals integer not null default 0,
  last_completed_date date,
  current_streak integer not null default 0,
  best_streak integer not null default 0,
  first_completed_at timestamptz,
  hidden_from_leaderboards boolean not null default false,
  hidden_reason text,
  hidden_at timestamptz,
  updated_at timestamptz not null default now()
);
create index long_shot_user_stats_points_idx
  on public.long_shot_user_stats (total_points desc, days_played desc)
  where hidden_from_leaderboards = false;
create index long_shot_user_stats_streak_idx
  on public.long_shot_user_stats (current_streak desc, best_streak desc)
  where hidden_from_leaderboards = false;
create index long_shot_user_stats_streak_reset_idx
  on public.long_shot_user_stats (last_completed_date) where current_streak > 0;
```
Tallies: service_role all only. Stats: authenticated SELECT own row;
service_role all; and column grants so the owner cannot read the
moderation note:
`revoke select (hidden_reason, hidden_at) on public.long_shot_user_stats from anon, authenticated;`
(RLS is row level, not column level, the rule the commerce section of
CLAUDE.md states; the admin page reads through service role.)

The two tables share one migration because they are the two aggregate
tables of the same feature; the RPCs in section 16 are in that same file
because they write these tables.

### 15.7 Verification sequence (every migration task)

1. Apply through MCP. 2. `select * from pg_policies where tablename like 'long_shot_%'`.
3. Probe as anon and as a real authenticated user through begin/rollback
   (memory: reference_mcp_rollback_verification): anon gets zero rows on
   every table; the owner gets own rows on attempts, answers and stats, and
   nothing on puzzles, prompts and tallies; the owner selecting
   `hidden_reason` gets a permission error. 4. Confirm writes are blocked
   for both. 5. Regenerate types. 6. Record in progress.md.

---

## 16. RPCs

All `security definer`, `set search_path = public`, revoked from public,
anon and authenticated by name, granted to service_role only.

### 16.1 long_shot_increment_tally(p_prompt_id uuid, p_player_id uuid)

Upserts `long_shot_answer_tallies` (+1 on conflict) when `p_player_id` is not
null, and always `update long_shot_prompts set answered_total = answered_total + 1
where id = p_prompt_id`. Returns void. One statement each, in one function,
so the two counters move together.

### 16.2 long_shot_trade_counts(p_since timestamptz)

```
select key as sleeper_player_id, count(distinct t.league_id)::int as league_count
from public.league_transactions t, jsonb_object_keys(t.adds) as key
where t.type = 'trade' and t.status = 'complete'
  and t.created_at_sleeper >= p_since
group by key
having count(distinct t.league_id) > 10
```
Returns `table (sleeper_player_id text, league_count int)`. The `having`
floor keeps the result small; family 7 applies its own higher floor.

### 16.3 long_shot_complete_attempt(p_attempt_id uuid)

Guarded update:
```
update long_shot_attempts a
set status = 'completed', completed_at = now(), total_points = base_points
where a.id = p_attempt_id and a.status = 'active'
  and a.current_position = (select p.prompt_count from long_shot_puzzles p where p.id = a.puzzle_id) + 1
returning *
```
then `update long_shot_puzzles set completed_attempts = completed_attempts + 1`
when the row was updated AND mode = 'hurry_up'. Returns the updated row or
null. Completion is keyed on `prompt_count`, never on the literal 5, so a
`short` puzzle completes. The answer route calls the RPC when
`position = prompt_count`.

---

## 17. Server entry points

All game routes live under app/api/games/long-shot/ and share
lib/long-shot/route-helpers.ts, which re-exports requireFfBeaconHeader and
privateJson from lib/signal-scout/route-helpers.ts (no second copy) and adds
`requireUser(req)` returning the Supabase user or a 401 response. Every route:
header guard first (403), then user (401), then settings `game_enabled` (503),
then zod on the body, then the rate claim, then the engine. All JSON responses
through privateJson (no-store). `export const dynamic = "force-dynamic"`.

Rate buckets through claimRateLimitSlot, all fail closed:
`long-shot-start` 6 per 60 s, `long-shot-next` 30 per 60 s,
`long-shot-answer` 30 per 60 s, `long-shot-state` 30 per 60 s,
`long-shot-search` 20 per 10 s, `long-shot-boards` 60 per 60 s.

### 17.1 GET /api/games/long-shot/state

Returns the page state for the signed-in user:
`{ gameDate, puzzle: { status, promptCount } | null, active: AttemptDto | null,
hurryUpToday: AttemptDto | null, stats: StatsDto | null, yesterday: YesterdayDto | null }`.
Used by the client after mutations; the page server-renders the same object
on first load through the same loader `loadPageState(admin, userId, today)`.
Never generates a puzzle. Runs the `recordCompletion` heal (section 12).

### 17.2 POST /api/games/long-shot/attempt  body `{ mode }`

Exports `maxDuration = 60`. Starts an attempt. Refuses with 409
`attempt_active` when the user has any active attempt (the client resumes
it instead). hurry_up: `ensurePuzzle(today)` (the one inline generation
path; 503 `puzzle_unavailable` when it produced no puzzle, section 7.2);
insert the attempt (a 23505 on the unique index means today's hurry_up
already exists: return that attempt's DTO with no error, which is the
CompletedDto or the abandoned state for a closed one); serve position 1
through the same function /next uses. film_room: 403 `film_room_disabled`
when the setting is off; pick the game date (section 8.1); ensure that
date's puzzle exists (a past date with no puzzle: use the most recent date
that has one; none at all: return 409 `no_puzzle`, client copy "Film Room has
no past puzzle yet. Play today's Hurry-Up first; Film Room opens on today's
puzzle when it is done."); insert; serve position 1. `timer_seconds` is set
from settings for hurry_up and null for film_room.

### 17.3 POST /api/games/long-shot/attempt/[id]/next

Serve-next (section 8.2). Ownership check: attempt.user_id must equal the
caller (404 otherwise, never 403, so an id cannot be probed). Attempt not
`active`: 409 `attempt_closed`. Repair: if the answer row at
`current_position` exists and is not pending, the attempt row is behind (a
crash between the two writes in 17.4); advance `current_position` by one
with a guard on its old value, recompute `base_points` from the answer rows,
and continue. Returns
`PromptDto = { attemptId, position, promptCount, promptText, remainingMs | null, mode, gameDate }`
or, when `current_position = prompt_count + 1`, the CompletedDto (calling
the completion RPC if it has not run, which is a second repair path).

### 17.3a POST /api/games/long-shot/attempt/[id]/end

Film Room only (400 `not_film_room` for a hurry_up attempt). Ownership
(404); guarded update `status = 'abandoned'` from `active`; returns the
page state. Bucket `long-shot-next`.

### 17.4 POST /api/games/long-shot/attempt/[id]/answer  body `{ position, playerId | null, timedOut, skipped }`

Order: ownership (404); attempt `active` (409 `attempt_closed`); position
must equal `current_position` and the answer row must be `pending` (409
`stale_prompt`); rate claim; timer check (hurry_up); `skipped` accepted only
in film_room; score against `prompt.answers`; guarded update of the answer
row from `pending`; guarded update of `attempts.current_position = position + 1`
and `base_points` recomputed from the answer rows; tally RPC (hurry_up
only); if position was `prompt_count`, call long_shot_complete_attempt and,
for hurry_up, `recordCompletion` (section 12); return
`ResultDto = { tier | null, points, correct, playerName, playerSlug, sleeperId,
team: { code, primary, secondary, tertiary } | null, roomCount, roomTotal,
mostGiven: Array<{ playerName, slug, sleeperId, teamCode, tier, count }>,
next: { position, promptCount } | CompletedDto }`.
`team` is the answered player's current `players.team` resolved through
`loadTeamColors` (section 18A.1) and is null for a miss, a timeout or a
player with no team.
The response NEVER carries the next prompt's text and never creates its
answer row (section 8.2). `mostGiven` is the top five correct answers by
tally count, ties by player name, excluding count 0, resolved with one
`.in()` of at most five ids. Never includes the full answer set.

### 17.5 GET /api/games/long-shot/search?q=

Same hardening as app/api/games/signal-scout/search/route.ts but requires a
signed-in user (401 for anyone else, because the demo does not use it) and
uses the `long-shot-search` bucket.

The search pool is NOT the Signal Scout rankings window
(lib/player-search.ts rankedPlayerIdSet keeps only players ranked in the
last 90 days, which drops the retired players that ARE the long_shot tier of
a historical prompt). lib/long-shot/search-pool.ts exports
`longShotSearchPool(admin): Promise<Set<string>>`: every players.id at an
ELIGIBLE_POSITIONS position that has at least one player_stats row with
`season >= STATS_FLOOR_SEASON`, memoized in process for five minutes the way
rankedPlayerIdSet is. Add a `pool` option to searchFantasyPlayers accepting
a Set of ids (the existing "ranked" and "ranked+idp" behavior unchanged when
it is absent) and pass this set. Returns `{ results: SearchPlayerResult[] }`
in the shape of lib/signal-scout/client.ts SearchPlayerResult so the
combobox can be shared (section 18.3).

### 17.6 Cron routes

Both export `maxDuration = 300` and pass `{ timeoutMs: 280_000 }` to
recordCronRun, the recalculate-derived pattern.

- GET /api/cron/long-shot-generate, schedule `0 17 * * *`: verifyCronRequest,
  recordCronRun("long-shot-generate"), then `generatePuzzle(admin, today, "cron")`
  if today has no row (a missed night that nobody played), then
  `generatePuzzle(admin, tomorrow, "cron")` unless a row exists (then
  `skipped`). The result payload records every
  family tried, its parameters, its answer count and pass or fail reason, the
  chosen completed week, the rate season used and the rate-0 share per
  prompt, so the admin page's skip log reads from cron_runs. Registered in
  lib/cron-runs.ts CronJobName and CRON_JOBS with a plain-English
  description, and in vercel.json.
- GET /api/cron/long-shot-settle, schedule `30 5 * * *`: settle every
  unsettled puzzle with `game_date <= yesterday`, oldest first, stopping
  before starting a new puzzle when under 60 seconds remain (the per-attempt
  guard in 10.3 makes a partial night safe and the next night finishes it);
  then prune film_room attempts older than 30 days (one DELETE by
  `started_at`); then delete `long_shot_answer_tallies` rows for puzzles
  older than 90 days (one DELETE through a subselect). Registered the same
  way.

### 17.7 GET /api/games/long-shot/leaderboards?board=&page=&date=

Public shape as Signal Scout's, requires a signed-in user (401 otherwise),
bucket `long-shot-boards`. `date` is optional, `YYYY-MM-DD`, used by the
daily board only, must be today or earlier. 503 `leaderboards_disabled` when
the setting is off.

### 17.8 Admin server actions (app/admin/long-shot/actions.ts)

`saveLongShotSettings(formData)`, `regenerateTomorrow()`,
`regenerateDate(gameDate)`, `hideUserFromBoards(userId, reason)`,
`unhideUser(userId)`, `settleNow(gameDate)`. Every action calls requireAdmin
first and validates with zod. `regenerateTomorrow` with no existing row
simply generates (salt 0, `generated_by = 'admin'`).

Regeneration is refused when the date has ANY attempt in either mode (a
delete would cascade through prompts to a live Film Room player's answers).
It is `delete` of the puzzle row followed by `generatePuzzle` with
`seed_salt + 1` and `generated_by = 'admin'`, inside
`coalesce("long-shot:generate:" + D)`, so an inline generation for the same
date cannot interleave.

`settleNow` is refused for today, is idempotent (section 10.3), and may be
run for a date already stamped to finish a partial night.

---

## 18. Client components and accessibility

Directory app/games/long-shot/. Every component is a file of its own,
kebab-case, PascalCase export.

- page.tsx (server, `export const dynamic = "force-dynamic"`): metadata
  through pageShareMetadata({ key: "long-shot" }), JSON-LD through
  webApplicationJsonLd with category "GameApplication"; reads settings, the
  user, `loadPageState`, leaderboard page 1; renders masthead, demo or game,
  rail. Never generates a puzzle. Picks the main panel per 5.1a.
- long-shot-client.tsx (client): owns the state machine (idle, picking,
  prompting, result, completed, paused, closed), calls the routes through
  lib/long-shot/client.ts, and owns the state live region.
- mode-picker.tsx: two buttons in a `role="group"` labeled "Choose a mode".
  Hurry-Up carries `aria-describedby` pointing at its description.
- prompt-card.tsx: status line, h2 prompt text, the combobox slot, the
  buttons.
- countdown.tsx: section 8.3, including the timer live region.
- player-combobox.tsx: see 18.3.
- result-panel.tsx: section 5.3; the most-given list is a `<ul>` of links.
- completion-panel.tsx: section 5.4; the tier row is one text node with each
  letter's word in `sr-only` inside the same element ("C, chalk").
- yesterday-panel.tsx, my-record-panel.tsx, leaderboard-rail.tsx,
  leaderboard-panel.tsx (copied structurally from Signal Scout's with the
  profile link added), demo.tsx, how-it-works.tsx, written-sections.tsx,
  loading.tsx, error.tsx.

### 18.1 Accessibility rules that apply here specifically

- One h1 (the masthead). Prompt text is h2. Panel headings h2 in the rail.
- Every figure is one text node; missing words appended in `sr-only` inside
  the same element. Nothing visible is `aria-hidden` except decorative icons;
  the countdown is visible, un-hidden text outside any live region (8.3).
- Focus: on prompt load focus moves to the prompt heading (h2), never
  straight into the combobox, because a reader must hear the prompt before
  typing and the heading is read once as focus lands; the combobox is the
  next Tab stop. On the result panel focus moves to its h2 ("Result for
  prompt 2"); on completion to the completion h2.
- Live regions: exactly one region speaks on any event. Prompt load and the
  two countdown marks belong to the timer region; result, completion,
  errors, resume and paused belong to the state region; the combobox status
  speaks only about search results; the copy button's region speaks only
  about the copy. The state region is silent on prompt load.
- Buttons are at least 44 by 44 CSS px. The mode picker buttons are full width
  below sm.
- No data hidden at any breakpoint. The leaderboard table collapses to
  stacked rows below sm with every column present.
- The prompt is in the DOM before the clock starts, and the clock starts
  from the server's served_at, set when /next was called, so rendering time
  does not eat the limit.

### 18.2 Client error states (long-shot-client.tsx)

- 429 on answer: "Too many requests. Your clock is still running; try again."
  (the server deadline is unchanged).
- 503 game_disabled mid-attempt: swap to the paused panel.
- Network failure on an answer: retry once, then "Could not reach the
  server. Press Answer again." with the same player still selected.
- 409 stale_prompt: call /next and render whatever it returns.
- 409 attempt_closed: "This attempt was closed when the day ended. Your
  answered prompts are kept as an abandoned day." then reload page state.
- 409 attempt_active on start: reload page state and resume.
- 409 no_puzzle on Film Room start: the sentence in 17.2.
- 503 puzzle_unavailable on Hurry-Up start: the sentence in 7.2, picker stays.
- 403 film_room_disabled: reload page state (the button should not have
  rendered).
- Any other non-2xx or malformed body: "Something went wrong. Reload the
  page to continue; your attempt is saved." No raw error text is shown.

### 18.3 The combobox

Extract app/games/signal-scout/guess-combobox.tsx into
components/player-guess-combobox.tsx with props
`{ disabled, ruledOutIds, helpText, debounceMs, minLength, showHeadshots, search: (q, signal) => Promise<{ results: SearchPlayerResult[] }>, onSelect }`.
With `showHeadshots` true (Long Shot passes true; Signal Scout passes false
and is unchanged), each option renders a 28 px PlayerHeadshot and a 14 px
NflTeamLogo before the name, both decorative, with position and team as
text after it, so a reader picking under the clock can confirm the player
by face and crest as well as by name.
`SearchPlayerResult` moves into that component file (exported there) and
lib/signal-scout/client.ts re-exports it, so a shared component does not
depend on one game's client. The listbox renders at most 8 options so
arrowing through results under the clock is bounded. Signal Scout's
guess-combobox.tsx becomes a thin wrapper passing its search function, its
help sentence, `debounceMs = 1000` and `minLength = 2`; Long Shot passes a
search function calling /api/games/long-shot/search, help text "Type a name.
Choose one player, then press Answer.", `debounceMs = 350` and
`minLength = 2`. A new components/player-guess-combobox.test.tsx covers:
results render after the injected search resolves; a ruled-out option is
skipped by arrow keys; Enter commits; Escape closes; a rate_limited result
keeps prior results on screen. The Signal Scout wrapper is covered by the
whole-suite run; there are no Signal Scout combobox tests today.

---

## 18A. Visual design (locked)

The art direction is "stadium at night": one lit stage in the middle of a
dark page, a football field drawn as a strip of light, and every answer
landing on it as a kick that travels as far as its rarity. The other two
games are dossiers and ballots; this one is a field. Nothing below is
optional and nothing is left to taste.

### 18A.1 The signature graphic: the field strip

`components/long-shot/field-strip.tsx`, geometry in
`lib/long-shot/field-geometry.ts` (pure, tested) so the strip and any future
image draw the same picture.

- An SVG with `viewBox="0 0 1000 120"`, width 100 percent, height scales.
  Background a rounded rect (`rx 14`) filled `#0B0B14`. Yard lines every 100
  units from x=100 to x=900 (ten of them), stroke `#2A2A47` width 2; hash
  marks between them at y 30 and y 90, 6 units tall, stroke `#1F1F33`. The
  end zone is x 900 to 1000, filled with the beacon gradient at 22 percent
  opacity, with the words "LONG SHOT" set vertically in Geist Mono 900 at 14
  units, fill `#22D3EE`, opacity 0.7. The left 0 to 100 is the "chalk" zone,
  filled `#8A8A9C` at 8 percent opacity.
- A tier maps to a landing x: chalk 100, field 300, deep 600, sleeper 850,
  long_shot 950; a miss or timeout stays at x 40 (behind the line) drawn as
  a hollow marker. The mapping is `landingX(tier | null)` in field-geometry.
- A marker is a circle r 16 at y 60 filled with the tier color (18A.3), a 3
  unit `#07070D` stroke, and the prompt number in Geist Sans 700 at 16 units
  centered in `#07070D` (chalk's gray marker uses `#F4F4F8` text). Markers
  of the same tier on the same day are spread by 36 units left to right in
  prompt order so they never overlap.
- The strip is `role="img"` with `aria-label` built by `fieldStripLabel()`:
  "Your answers on the field: prompt 1 Chalk, prompt 2 Field, prompt 3
  Deep, prompt 4 Sleeper, prompt 5 Long Shot. Total 285 points." The real
  data is ALWAYS also present as a `<ol>` directly under the strip (prompt
  number, tier word, points, player name), so the strip is illustration and
  the list is the record. Nothing is hidden at any breakpoint; the strip
  shrinks, the list stacks.
- Motion: when a marker is added it translates from x 40 to its landing x
  over 600 ms with the site's default easing. Under `prefers-reduced-motion`
  it appears in place. The strip is never animated otherwise, except for
  the kick trail below.

The kick trail (team colors, the one place they appear):

- When the answered player has an NFL team, the flying marker leaves a
  trail behind it in that team's primary and secondary colors from
  `nfl_teams`: two tapered paths (`trailPaths(fromX, toX, y)` in
  field-geometry, each a closed shape 28 units long at the marker and
  tapering to 0 at the tail, the primary above the center line and the
  secondary below, both at 85 percent opacity). The trail follows the marker
  for the 600 ms flight, then fades to 0 opacity over the next 400 ms and is
  removed from the DOM. After one second the marker sits alone in its tier
  color; the team colors never persist.
- When the landing tier is long_shot, the end zone flashes ONCE: its fill
  goes to the two team colors as a 50/50 vertical split at 60 percent
  opacity for 250 ms, then returns to the beacon gradient over 350 ms. One
  flash, never a loop, well under any photosensitivity threshold.
- A player with no team (retired, free agent) flies with no trail; a miss or
  timeout never flies. A team whose two colors are within a small distance
  of each other (both channels of the hex within 24) uses the tertiary color
  for the lower path, so the trail always reads as two tones.
- Under `prefers-reduced-motion`: no flight and no flash. The marker appears
  in place inside a thin two-color ring (primary left half, secondary right
  half, 3 units) that fades out over one second. Nothing moves.
- The trail and the flash are `aria-hidden` SVG elements inside the strip;
  the strip's label is unchanged. The team is already named as text beside
  the headshot, so the colors add nothing a reader needs.
- Colors come to the browser only inside the answer response (`team` on
  `ResultDto`, section 17.4), read server-side from `nfl_teams` through
  `lib/long-shot/team-colors.ts loadTeamColors(admin)`: one select of
  `abbreviation, primary_color, secondary_color, tertiary_color` for all 32
  rows, held in `unstable_cache` for 24 hours under the key
  `["long-shot-team-colors"]`. A code with no row yields `team: null` and a
  plain flight.

The strip appears in three places: small (height 72 px) in the status line
during an attempt, where it is the progress indicator (filled markers for
answered prompts, dim outlined circles at x 40 for the rest); full size on
the result panel, where the new marker lands; and full size on the
completion panel with every marker labeled.

### 18A.2 The stage

The whole game lives on ONE element, `components/long-shot/stage.tsx`: a
centered column `max-w-3xl`, `rounded-[24px]`, border `border-line-accent`,
background `#0F0F1A` with two radial "stadium light" gradients fixed at the
top corners (`radial-gradient(ellipse at 0% 0%, rgba(34,211,238,0.16), transparent 55%)`
and `radial-gradient(ellipse at 100% 0%, rgba(168,85,247,0.18), transparent 55%)`),
and behind the content a faint yard-line pattern (an SVG `<pattern>` of
vertical lines every 48 px at 5 percent white opacity, `pointer-events-none`,
`aria-hidden`). Padding 20 px on phones, 32 px from sm. A 3 px beacon
gradient bar across the top edge. Inside the stage there are NO nested
bordered boxes: sections are separated by 1 px hairlines (`border-line`)
and by spacing, never by another card.

During an attempt the stage is the only thing on the page below the hero;
the boards and the record are NOT shown beside it (the Signal Scout rail
pattern is explicitly not used here). They render below the stage, after
completion or when idle, in a two-column grid from lg (boards left, record
and Yesterday right), single column below.

### 18A.3 Color, type and the tier ramp

- Base, surface, ink and brand colors are the tokens in tailwind.config.ts.
  No position-palette colors appear in this game (a QB answer is not red
  here; the tier is the only color meaning).
- Tier ramp, used for markers, chips and the result headline, each ALWAYS
  beside its word:
  - chalk `#8A8A9C` (ink-subtle)
  - field `#C084FC` (brand purple-light)
  - deep `#A855F7` (brand purple)
  - sleeper `#22D3EE` (brand cyan)
  - long_shot: the beacon gradient (text through `bg-clip-text`, fills as
    `url(#beacon)`), with a glow `0 0 32px -8px rgba(34,211,238,0.9)`.
  - miss: `#EF4444` border only, no fill, word "Miss".
  The ramp lives in `lib/long-shot/tier-style.ts` as one exported record,
  used by every component, so a tier never has two colors.
- Numbers are the loudest thing on screen. The points reveal, the daily
  total, the clock and the podium figures are Geist Sans `font-black`,
  `tabular-nums`, `tracking-tight`, `leading-none`: points reveal
  `text-6xl sm:text-7xl`; daily total `text-7xl sm:text-8xl`; clock
  `text-4xl`; podium first `text-5xl`, second and third `text-3xl`. Labels
  under them are `text-xs uppercase tracking-[0.18em] text-ink-subtle`.
  Every big number is one text node with its unit in `sr-only` inside the
  same element.
- Prompt text is `text-2xl sm:text-3xl font-semibold leading-snug
  tracking-tight text-ink`, left aligned, max 28 words by construction of
  the templates.

### 18A.4 The Long Shot mark

`components/long-shot/long-shot-mark.tsx`, an inline SVG, `viewBox="0 0 48 48"`,
`aria-hidden="true"` wherever the name is adjacent text, `role="img"
aria-label="Long Shot"` where it stands alone. Elements, in draw order:

1. Goal post at the right: two uprights `x=38` and `x=44` from `y=10` to
   `y=30`, crossbar `y=30` from `x=36` to `x=46`, stroke `#F4F4F8` width 2.2,
   round caps, opacity 0.9.
2. The flight arc: `M 4 40 Q 22 -6 40 18`, stroke `url(#beacon)` (purple at
   the start, cyan at the end) width 2.6, round caps, `stroke-dasharray
   "3 4"` on the first 40 percent (drawn as a second path segment) so the
   arc reads as a trail that becomes solid near the ball.
3. The ball: an ellipse centered `(40, 18)`, `rx 5.2 ry 3.4`, rotated 35
   degrees, fill `#22D3EE`, with a lace line `M 37.6 17.2 L 42.4 18.8`
   stroke `#07070D` width 1.2.
4. The kick spot: a filled circle at `(4, 40)` r 2.4 fill `#A855F7`.

It renders at 28 px in the hero, 20 px beside the game name in the nav
card, and at 160 px as the hero's background ornament at 6 percent opacity
(`pointer-events-none`, `aria-hidden`). The lucide Crosshair icon is used
ONLY where the site requires a NavIconName (section 19); the mark is used
everywhere Long Shot itself is drawn.

### 18A.5 The hero

Replaces PageMasthead for this page (`components/long-shot/hero.tsx`). Full
width, same stadium-light gradients as the stage, the large mark ornament at
the right. Left column: eyebrow "Daily rarity game" in cyan mono uppercase,
h1 "Long Shot", one-line "Five prompts. Rare answers win.", and the date
line "Puzzle for Saturday, November 7" with a small streak flame chip beside
it when the signed-in reader has a streak ("4 day streak", lucide Flame in
`#F59E0B`, the word always present). Signed out, the date line is replaced by
"Sign in to play today's five."

### 18A.6 The mode picker

Two tickets side by side from sm, stacked below, each a `<button>` at least
120 px tall, `rounded-[20px]`, `border-2`:

- Hurry-Up: border and icon `#22D3EE`, lucide Zap at 28 px, label "Hurry-Up"
  `text-2xl font-black`, under it "30 seconds a prompt. Counts for streaks
  and the boards.", a small "Default" chip. Focus ring cyan. Hover and focus
  lift 2 px with a cyan glow; none under reduced motion.
- Film Room: border and icon `#A855F7`, lucide Clapperboard at 28 px, label
  "Film Room", under it "No clock. Practice only; nothing is recorded."

### 18A.7 The clock badge

`components/long-shot/clock-badge.tsx`, top right of the stage in Hurry-Up.
A 72 px square: the seconds as `text-4xl font-black tabular-nums` text (the
visible figure, not hidden, section 8.3), the word "sec" in `sr-only` inside
the same element, and around it a decorative SVG ring (`aria-hidden`,
`pointer-events-none`) r 32, stroke 4, whose `stroke-dashoffset` depletes
once per second with a 1 s linear transition. Ring color `#22D3EE` above 10
seconds, `#F59E0B` from 10, `#EF4444` from 5; the number takes the same
color. Under reduced motion the ring stays full and only the colors change.
The timer live region (8.3) is a sibling `sr-only` element, not the badge.

### 18A.8 The result reveal

On answer, the combobox area is replaced in place (no layout jump above
it):

1. The player's headshot (`components/player-headshot.tsx`, 72 px, square
   corners, tier-colored 3 px ring) with name and team beside it.
2. The headline: the points at `text-6xl sm:text-7xl` in the tier color (or
   the gradient for long_shot), counting up from 0 over 500 ms (static under
   reduced motion), and the tier chip beside it: a pill with the tier word,
   tier-colored border and 15 percent tint, lucide icon per tier (chalk
   Target, field Goal, deep LocateFixed, sleeper RadioTower, long_shot Flame,
   miss nothing).
3. The field strip, full size, with the new marker landing.
4. "The room" as bars: each of the up to five most-given correct answers is
   a row with a 32 px headshot, the team logo, the player name linked, a
   horizontal bar whose width is the
   answer's share of `answered_total` (min 4 px), filled in that answer's
   tier color, and the count and percent as text. The reader's own answer
   row is outlined in ink when it appears, and when it does not (a rarer
   answer) a sixth row at the bottom shows it with the same bar.
5. The Next button, full width on phones, right aligned from sm, `h-12`,
   cyan fill with `#07070D` text (the one solid button on the stage).

### 18A.9 The completion sheet

The stage becomes the completion sheet:

1. A thin "Day complete" eyebrow, then the total at `text-7xl sm:text-8xl`
   in the beacon gradient when any answer reached long_shot, otherwise ink.
   The bonus line under it once settled ("+15 Lone Signal", with the
   RadioTower icon).
2. The full field strip with all markers labeled, and the record list, each
   row carrying the answered player's 32 px headshot and team logo beside
   his name (a miss or timeout shows a hollow placeholder).
3. The tier letter row rendered as five large tiles (56 px, tier-colored
   border, the letter at `text-2xl font-black`, the word in `sr-only` inside
   the tile), which is exactly what the share text encodes.
4. A stats strip of three big figures: today's rank, current streak, best
   day. Each is one text node with the unit inside.
5. The two copy buttons and the Film Room button.

### 18A.10 The podium and the boards

`components/long-shot/podium.tsx`, the top three of the DAILY board, drawn
once above the board list (never inline in the game loop). From sm, three
columns with first in the middle and taller (`sm:order-2`, cards `h-56`
versus `h-44`); below sm, stacked first to third. An ordered list in rank
order whatever the visual order, `aria-label` "Today's podium".

Each card: avatar 72 px (first 96 px) inside a metal ring, the display
name (linked to the Signal profile when live), the points at the podium
sizes in 18A.3, and a place badge under the avatar reading "1st", "2nd",
"3rd" with the word "place" in `sr-only`. Metal tones (decision 13), each
measured against `#0F0F1A` for AA at every size they carry:

- gold `#F5C451` (ring 4 px, badge border and text, a glow
  `0 0 48px -12px rgba(245,196,81,0.55)`)
- silver `#C9CDD6` (ring 3 px, badge border and text)
- bronze `#D08A5B` (ring 3 px, badge border and text)

The lucide Medal icon sits in the badge beside the place word in the same
metal tone. Below the podium the board continues from rank 4 as rows:
rank at `text-xl font-black tabular-nums` in a fixed 44 px column, avatar
32 px, name, and the figure right-aligned in Geist Mono `font-bold`. The
reader's own row carries a cyan "You" chip and a cyan left border. The
all_time and streak boards use the same rows without a podium.

### 18A.11 Yesterday, record and Lone Signal

- The Yesterday card has a "Settled" stamp: a rotated (-6 degrees) pill at
  the top right, mono uppercase, cyan border, reading "Settled" or "Not
  settled yet". Under reduced motion nothing differs (it is static anyway).
- The Lone Signal badge is a pill with the RadioTower icon and the words
  "Lone Signal", cyan, with a soft pulse (`animate-pulse` on the icon only,
  removed under reduced motion).
- My record is a grid of six big figures (18A.3 sizing, `text-4xl`) plus the
  seven-day letter row drawn as seven 36 px tiles.

### 18A.12 The demo

The demo uses the same stage, strip, clock badge and reveal, so it looks
exactly like the game, with a diagonal "Sample" ribbon across the top right
corner of the stage (mono uppercase, `#F59E0B` border and text) and the
heading from section 11.

### 18A.13 Motion and feel rules

- Durations: 180 ms for hover and focus, 500 ms for the count-up, 600 ms
  for the marker flight. Easing is the site default.
- Every animation is removed or made instant under `prefers-reduced-motion`
  through Tailwind `motion-reduce:` classes or a `useReducedMotion` check;
  no animation ever carries meaning.
- Nothing flashes more than once per second; the ring transition is
  continuous, not stepped.
- Decorative overlays (gradients, the yard pattern, the mark ornament, the
  ring) are `aria-hidden` and `pointer-events-none`, per the Panel's own
  comment on why.

---

## 19. Registration points

Every one of these is a task. Grep for `would-you-rather` to find the exact
line each lives on; add Long Shot beside it with the same shape.

1. lib/games-catalog.ts: extend `GameHref` with "/games/long-shot"; add the
   entry `{ href, title: "Long Shot", tagline: "Five prompts. Rare answers win.",
   description: "The same five fantasy prompts for everyone, every day. Name a
   player who fits. The answer everyone gives scores 10; the one nobody
   rosters scores 100.", cta: "Play today's five" }`. Run lib/llms/build.test.ts
   after the change.
2. lib/site.ts: GAMES_NAV entry (label "Long Shot", description "Five
   prompts. Rare answers win."); SEARCHABLE tools entry with keywords
   ["game", "games", "daily", "trivia", "long shot", "rare", "prompts"];
   footer Games links entry.
3. lib/nav-tree.ts: GAME_ICONS "/games/long-shot": "crosshair" (add
   "crosshair" to components/app-shell/nav-icons.tsx NavIconName mapped to
   lucide Crosshair); admin nav entry `{ id: "/admin/long-shot", label: "Long
   Shot", href, hint: "Daily rarity game, puzzles, settings and boards", icon: "crosshair" }`.
4. app/games/page.tsx: GAME_PRESENTATION "Long Shot": { icon: Crosshair,
   status: "New" }; update the masthead stats and the rail sentence that
   names which games need an account ("Long Shot needs one for every
   round").
5. app/page.tsx: FEATURED_GAMES entry with the catalog description and
   Crosshair icon.
6. app/api/og/page/[key]/route.tsx PAGE_CARDS "long-shot": eyebrow "Daily
   rarity game", headlineTop "Five prompts.", headlineBottom "Rare answers
   win.", subhead "The same five fantasy prompts for everyone, every day.
   The answer everyone gives scores 10. The one nobody rosters scores 100.",
   facts ["New puzzle daily", "Free to play", "Streaks and boards"],
   path "/games/long-shot", badge "Long Shot".
7. lib/cron-runs.ts: two CronJobName members and CRON_JOBS entries;
   vercel.json: two cron entries (section 17.6).
8. lib/analytics.ts: add "long_shot" to `AnalyticsTool`; add to the
   `AnalyticsEvent` union, in its `{ name, params }` shape:
   `long_shot_start { mode }`, `long_shot_complete { mode, points }`,
   `long_shot_share { method: "copy_text" | "copy_link" }` (a new event, so
   the existing share event's params are not widened).
9. lib/sitemap/sections.ts: add `{ path: "/games/long-shot", priority: 0.4 }`
   beside the two games.
10. lib/llms/llms-txt.ts and llms-full-txt.ts read playableGames(), so
    nothing to do; the task confirms by reading the output.
11. CLAUDE.md: a new section "Long Shot (the daily rarity game)" after the
    Would You Rather section, written from sections 1, 8, 9, 10, 12 and 13
    of this plan as rules, with the module map. Written in LS-T060.
12. docs/README.md: the Active row for this plan exists; at launch the file
    moves to docs/completed/long-shot/ and the row moves to Completed.

---

## 20. Module map and signatures

lib/game-date.ts (LS-T001): `currentEasternGameDate(now?)`,
`isConsecutiveDay(prev, next)`, `addDays(date, n)`. The first two are MOVED
from lib/signal-scout/streaks.ts, which then re-exports them, so the three
existing importers (lib/signal-scout/route-helpers.ts, leaderboards.ts,
app/games/signal-scout/page.tsx) do not change. Tests move with them
(lib/game-date.test.ts) and the streaks test file keeps a one-line
re-export test.

lib/long-shot/
- types.ts: `Tier`, `TIERS` (ordered), `Mode`, `ELIGIBLE_POSITIONS`,
  `STATS_FLOOR_SEASON`, `AnswerEntry = { player_id: string; tier: Tier; rate: number }`,
  `PromptDto`, `ResultDto`, `CompletedDto`, `AttemptDto`, `StatsDto`,
  `YesterdayDto`, `LongShotSettings`. Header comment carries the rules from
  sections 1 and 8.1.
- default-settings.ts: `DEFAULT_LONG_SHOT_SETTINGS` (section 21).
- settings.ts: `LONG_SHOT_SETTINGS_ID = "global"`, zod schema,
  `validateLongShotSettings`, `clampLongShotSettings`, `loadLongShotSettings(admin)`,
  `saveLongShotSettings(admin, settings, userId)`. Shape as
  lib/would-you-rather/settings.ts.
- random.ts: `mulberry32(seed): () => number`, `seedFor(gameDate, salt): number`,
  `shuffle<T>(items, rng)`, `pick<T>(items, rng)`. Pure.
- templates/types.ts: `TemplateFamily = { key; enabledByDefault; draw(rng, ctx); text(params, ctx); answers(admin, params, ctx): Promise<string[]> }`
  and `GenerationContext = { season: number; seasons: number[]; completedWeek: number | null; defaultSource: { slug; display }; formats: FormatRow[]; rateSeason: number | null }`.
- templates/game-line.ts, opponent-line.ts, season-finish.ts,
  market-rank.ts, value-mover.ts, waiver-wire.ts, league-trades.ts: one
  family each, exactly as section 7.2. templates/index.ts exports `FAMILIES`.
- completed-week.ts: `findCompletedWeek(admin, season)` per the test in 7.2. 
- rates.ts: `chooseRateSeason(admin, minLeagues)` and
  `loadRosterRates(admin, season, playerIds): Promise<Map<string, number>>`
  chunked 200 ids per `in()`.
- search-pool.ts: `longShotSearchPool(admin)` (section 17.5).
- tiers.ts: `assignTiers(entries, cutoffs, points): AnswerEntry[]` and
  `pointsFor(tier, points)`. Pure.
- generate.ts: `generatePuzzle(admin, gameDate, generatedBy, salt)`,
  `ensurePuzzle(admin, gameDate)` (coalesced), `buildPuzzle(ctx, families, settings, rng, answersLoader, pool)`
  (pure given an injected answers loader and pool, so it is unit tested with fakes).
- attempt.ts: `startAttempt`, `serveNext` (with the repair path),
  `submitAnswer`, `recordTimeout`, `endFilmRoomAttempt`, `loadAttempt`,
  `toAttemptDto`, `findActiveAttempt(admin, userId)`,
  `pickFilmRoomDate(admin, userId, today)`.
  The status-guarded write pattern from the Signal Scout engine header.
- timer.ts: `isExpired(servedAt, limitMs, graceMs, now)`,
  `remainingMs(servedAt, limitMs, now)`. Pure.
- scoring.ts: `scoreAnswer(answers, playerId): { correct; tier | null; points }`,
  `sumPoints(answerRows)`. Pure.
- tallies.ts: `incrementTally(admin, promptId, playerId | null)`,
  `loadRoom(admin, promptId, playerId, answers): { roomCount; roomTotal; mostGiven }`.
- settle.ts: `settlePuzzle(admin, puzzleId, settings, deadline)`: abandon,
  per-attempt guarded bonus, stats, `settled_at`, the streak reset.
  `loneSignals(attemptAnswers, tallies, answeredTotal, settings)` pure.
- streaks.ts: `applyCompletion(prev, gameDate)`, `displayedStreak(stats, today)`. Pure.
- stats.ts: `recordCompletion(admin, userId, attemptId, today)` (anchored,
  section 12).
- leaderboards.ts: section 13.1.
- profile-links.ts: section 13.2.
- share.ts: `buildShareText(tiers: Array<Tier | null>, basePoints, bonusPoints, gameDate)`. Pure.
- demo.ts: section 11. Pure data.
- client.ts: typed fetch wrappers for every route in section 17, the
  Signal Scout client.ts pattern (x-requested-with header, ApiResult).
- route-helpers.ts: section 17 preamble.
- page-state.ts: `loadPageState(admin, userId, today)`.

components/player-guess-combobox.tsx (+ .test.tsx), components/copy-text-button.tsx.

components/long-shot/ (presentational, section 18A): stage.tsx, hero.tsx,
long-shot-mark.tsx, field-strip.tsx, clock-badge.tsx, tier-chip.tsx,
room-bars.tsx, podium.tsx, board-row.tsx, settled-stamp.tsx,
lone-signal-badge.tsx. lib/long-shot/field-geometry.ts (`landingX`,
`markerPositions`, `trailPaths`, `fieldStripLabel`; pure, tested),
lib/long-shot/tier-style.ts (the one tier color record, plus
`tierIcon(tier)`), lib/long-shot/team-colors.ts (`loadTeamColors(admin)`
cached 24 hours, and the pure `trailTones(primary, secondary, tertiary)`
that picks the two tones per section 18A.1).

app/api/games/long-shot/ (routes in section 17), app/api/cron/long-shot-generate/route.ts,
app/api/cron/long-shot-settle/route.ts, app/admin/long-shot/page.tsx,
actions.ts, long-shot-settings-manager.tsx, puzzle-preview.tsx.

---

## 21. Settings document

```
{
  game_enabled: true,
  timer: { seconds: 30, grace_seconds: 2 },          // seconds 10..120, grace 0..10
  tiers: {
    cutoffs: { long_shot: 0.10, sleeper: 0.25, deep: 0.50, field: 0.75 },  // strictly increasing, each in (0,1)
    points: { chalk: 10, field: 30, deep: 60, sleeper: 85, long_shot: 100 }, // 0..1000, strictly increasing
    min_rate_leagues: 50                              // 1..100000
  },
  bonus: { min_room: 20, lone_share: 0.05, points: 15 },  // min_room 1..10000, lone_share (0,1), points 0..500
  templates: {
    game_line:     { enabled: true, min_answers: 8, max_answers: 60 },
    opponent_line: { enabled: true, min_answers: 8, max_answers: 60 },
    season_finish: { enabled: true, min_answers: 8, max_answers: 60 },
    market_rank:   { enabled: true, min_answers: 8, max_answers: 60 },
    value_mover:   { enabled: true, min_answers: 8, max_answers: 60 },
    waiver_wire:   { enabled: true, min_answers: 8, max_answers: 60 },
    league_trades: { enabled: true, min_answers: 8, max_answers: 60 }
  },                                                   // min 3..200, max >= min, max <= 500
  leaderboards: { enabled: true, hide_admin_users: true },
  film_room_enabled: true
}
```
Unknown keys are stripped; missing keys take defaults (merge as
lib/would-you-rather/settings.ts mergeWouldYouRatherSettings does).
Behavior of each switch: `game_enabled` section 5.6; `film_room_enabled`
sections 5.2 and 8.1; `leaderboards.enabled` section 13.1;
`hide_admin_users` decision 10.

### 21.1 Admin page sections (/admin/long-shot)

1. Status: today's puzzle (date, status, prompt count, seed salt, completed
   attempts), tomorrow's puzzle (exists or not, Regenerate tomorrow button),
   last generate and settle cron runs from cron_runs.
2. Tomorrow's prompts preview: each prompt's text, template key, answer
   count, and the tier distribution (counts per tier). Tomorrow's answer
   names are shown in a `<details>` per prompt so the admin can judge the
   set. Today's answer names are never shown here.
3. Today's room: per prompt, answered_total and the top five tallies with
   names. Inside a `<details>` closed by default, with the sentence from
   decision 10 above it, so an admin checking settings does not see answers
   by accident.
4. Settings form: every field in section 21 with the clamp ranges in the
   help text. Save validates server-side and shows the first error in a
   status region.
5. Templates table: enabled toggle and bounds per family, plus the last 14
   days of tries (template key, parameters, answer count, pass or fail
   reason) read from the generate cron_runs result payloads.
6. Boards moderation: hide a user by user id with a required reason;
   unhide; list currently hidden (service-role read of hidden_reason).
7. Settle: a date input (Eastern, yesterday or earlier) and a Settle now
   button; refused for today; the sentence "Safe to run again; a settled
   attempt is never paid twice."

---

## 22. Tests

Vitest, colocated `*.test.ts`. Every pure module has one. Named cases the
builder must include:

- game-date.test.ts: moved cases plus `addDays` across the DST changes
  (2026-03-08, 2026-11-01) and a leap day.
- random.test.ts: same seed, same sequence; different salt, different
  sequence; shuffle is a permutation.
- tiers.test.ts: the 10/25/50/75 split on 20 entries; ties on rate share a
  tier; a set of 8 where every rate is 0 is all long_shot; cutoffs from
  settings respected.
- completed-week.test.ts: a week at 7 percent of the prior week is skipped;
  week 1 under 1,500 rows is skipped; no weeks returns null.
- rates.test.ts: the season with a tiny denominator is skipped for the prior
  one; none qualifying returns null.
- templates/*.test.ts: each family's text builder for every parameter (the
  source display name appears in families 4 and 5); `buildPuzzle` with a
  fake answers loader and a fake pool: five distinct families when all pass;
  the pool intersection drops an untypeable id; redraw on a too-small set;
  `short` status after exhaustion; the same seed and salt reproduce the same
  puzzle; the current season is not drawn when `completedWeek` is null;
  season_finish never draws the union with cutoff 24.
- timer.test.ts: boundary at limit, at limit plus grace, one millisecond past.
- scoring.test.ts: correct tier and points; a wrong player; a null player;
  `sumPoints` over rows.
- settle.test.ts: no Lone Signal under min_room but every attempt still
  settled with 0; share boundary at lone_share; bonus summed per attempt;
  abandoned attempts get no bonus; a second run over the same fixtures pays
  nothing (the guard returns no row); the streak reset zeroes only users
  whose last date is before the target.
- streaks.test.ts: first day, consecutive, gap, same day; displayedStreak
  lazy reset.
- share.test.ts: the three-line text, X for misses, {n} letters on a short
  day, the bonus suffix only when non-zero, no character outside ASCII.
- profile-links.test.ts: only live profiles map; chunking at 200.
- leaderboards.test.ts: ordering and tie-breaks per board; exclusion set;
  `profileHref` present only for live handles; no raw user id in a row; the
  daily cache key carries the requested date.
- route-helpers.test.ts: 403 without header, 401 without user, 503 when
  disabled.
- attempt.test.ts (with a fake client): the answer response carries no next
  prompt text; /next creates the pending row; the repair path advances a
  behind attempt and recomputes base_points; completion fires at
  prompt_count on a short puzzle.
- demo.test.ts: every demo answer name is in the candidate list; tiers are
  valid; no ASCII violations.
- field-geometry.test.ts: landingX for every tier and for null; same-tier
  markers are spread 36 units apart in prompt order and never overlap; the
  label names every prompt and the total; `trailPaths` returns two closed
  paths 28 units long that taper to the tail and never cross the center
  line.
- team-colors.test.ts: `trailTones` returns primary and secondary when they
  differ, swaps in the tertiary when both channels are within 24, and
  returns null for a missing team; the DTO carries null for a miss.
- tier-style.test.ts: every tier has exactly one color and one icon; the
  five metal and tier hex values are the ones in section 18A.
- components/player-guess-combobox.test.tsx: section 18.3.
- A guard test lib/long-shot/film-room-guard.test.ts: greps lib/long-shot/
  for every call of `incrementTally`, `recordCompletion`, `applyCompletion`
  and asserts each is inside a branch that checks `mode === "hurry_up"`
  (string match on the enclosing 12 lines, the same style as
  lib/projections/source-guard.test.ts). This is what keeps decision 2 true
  after the build.

---

## 23. Build order and tasks (progress.md section "## Long Shot")

Each task is atomic and ends with its colocated test passing, then the
progress.md and handoff.md update required by section 0. Phases close with
the gate: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
The single review is LS-T061; there are no per-phase sub-agent reviews.

Phase 0: foundation
- LS-T001 lib/game-date.ts with the moved helpers and `addDays`; streaks.ts re-exports; tests moved.
- LS-T002 progress.md section header and this task list pasted in as pending (the docs/README.md row already exists).

Phase 1: database (one migration per task, each with RLS verification)
- LS-T010 long_shot_settings.
- LS-T011 long_shot_puzzles.
- LS-T012 long_shot_prompts.
- LS-T013 long_shot_attempts.
- LS-T014 long_shot_answers.
- LS-T015 long_shot_answer_tallies, long_shot_user_stats (with the column revoke), the three RPCs.
- LS-T016 types regenerated; `lib/database.types.ts` committed.

Phase 2: pure model
- LS-T020 types.ts, default-settings.ts, settings.ts (+ tests).
- LS-T021 random.ts, tiers.ts (+ tests).
- LS-T022 completed-week.ts, rates.ts, search-pool.ts, the `pool` option on searchFantasyPlayers (+ tests).
- LS-T023 templates/types.ts, templates/index.ts, game-line.ts, opponent-line.ts (+ tests).
- LS-T024 season-finish.ts, market-rank.ts, value-mover.ts (+ tests).
- LS-T025 waiver-wire.ts, league-trades.ts (+ tests).
- LS-T026 generate.ts with buildPuzzle (+ tests with fake loader and pool).
- LS-T027 timer.ts, scoring.ts, streaks.ts, share.ts (+ tests).
- LS-T028 settle.ts pure half (+ tests).
- LS-T029 A dry-run script scripts/long-shot-dry-run.ts (`npx tsx --env-file=.env.local scripts/long-shot-dry-run.ts --date YYYY-MM-DD [--salt N]`) that prints the prompts, answer counts, tier distributions, the rate-0 share, the chosen completed week and the rate season WITHOUT writing. Run it for three dates and paste the output into progress.md under the task.

Phase 3: engine and routes
- LS-T030 components/player-guess-combobox.tsx extraction with its test; Signal Scout wrapper; whole suite green.
- LS-T031 attempt.ts (start, next with repair, answer, recordTimeout), tallies.ts, stats.ts, page-state.ts (+ attempt.test.ts).
- LS-T032 route-helpers.ts, client.ts; routes state, attempt (maxDuration 60), next, end, answer.
- LS-T033 search route; leaderboards.ts, profile-links.ts, leaderboards route.
- LS-T034 generate cron route and settle cron route with time budgets; cron-runs.ts and vercel.json entries.
- LS-T035 film-room-guard.test.ts.

Phase 4: page
- LS-T039 Design primitives: lib/long-shot/field-geometry.ts (with trailPaths), tier-style.ts and team-colors.ts (+ tests); components/long-shot/long-shot-mark.tsx, field-strip.tsx, tier-chip.tsx, clock-badge.tsx, stage.tsx, hero.tsx, settled-stamp.tsx, lone-signal-badge.tsx, exactly as section 18A.
- LS-T040 page.tsx (hero, stage, below-stage grid), loading.tsx, error.tsx, how-it-works.tsx, written-sections.tsx.
- LS-T041 long-shot-client.tsx state machine with every error state in 18.2, mode-picker.tsx (the two tickets), prompt-card.tsx, countdown.tsx (wires the clock badge), player-combobox.tsx.
- LS-T042 result-panel.tsx (the reveal, 18A.8) with the kick trail and end-zone flash, room-bars.tsx, completion-panel.tsx (the sheet, 18A.9), components/copy-text-button.tsx, analytics events.
- LS-T043 yesterday-panel.tsx (both settled and unsettled states), my-record-panel.tsx (18A.11).
- LS-T044 podium.tsx, board-row.tsx, leaderboard-rail.tsx, leaderboard-panel.tsx with profile links and the paused state (18A.10).
- LS-T045 demo.ts data (queries run once, results pasted) and demo.tsx with the clock choice, the native select and the Sample ribbon.
- LS-T046 Build agent's own pass of the page at 360, 768 and 1280 against sections 18 and 18A (one h1, no skipped heading, 44 px targets, nothing past the viewport, the live-region rule, every big figure one text node, metal tones only on the podium, reduced-motion check with the OS setting on); fixes. No sub-agent.

Phase 5: admin
- LS-T050 app/admin/long-shot/page.tsx, actions.ts, long-shot-settings-manager.tsx, puzzle-preview.tsx; nav-tree admin entry.

Phase 6: registration, device pass, review, hand-off, commit
- LS-T060 Registration points 1 to 11 of section 19; PAGE_CARDS entry rendered and checked at /api/og/page/long-shot; full gate green.
- LS-T060a DEVICE PASS IN A REAL BROWSER (section 23A). Every view of the game played through Claude in Chrome at phone, tablet, laptop and desktop widths, every defect fixed, the pass recorded in progress.md, gate re-run and green.
- LS-T061 THE ONE REVIEW. One reviewer sub-agent per section 0 item 6, over this plan and every file touched, every category. Every real defect fixed, every finding and its outcome recorded under this task, gate re-run and green.
- LS-T062 handoff.md final: what was built, and what the owner must do after the push deploys (confirm the first generate run in cron_runs; play one Hurry-Up and one Film Room day in production; confirm the next morning's settle run and the Yesterday panel; run the launch checklist in section 24). Also move this plan to docs/completed/long-shot/long-shot-plan.md with `git mv`, add a "What shipped differently" section listing every place the build departed from the plan (or the sentence "Nothing shipped differently"), and move its docs/README.md row from Active to Completed with the Left over column naming the owner's post-deploy checks.
- LS-T063 COMMIT AND PUSH TO MAIN, exactly per section 0 item 3. Record the commit hash in progress.md under this task. Pushing to main deploys the site; the build agent does nothing further after the push succeeds.

---

## 23A. The device pass (LS-T060a)

The game must be as good to look at and as easy to play on a phone as on a
desktop. This task proves it in a real browser before the review, and it is
the build agent's own work, not a sub-agent's.

### 23A.1 Setup

- Run the production build locally (`npm run build`, then `npm run start`),
  not the dev server, so what is measured is what ships. If a dev server is
  already running on port 3000, stop it first; both use .next.
- Use Claude in Chrome (the browser extension tools; load the
  anthropic-skills:chrome-browser skill first). Sign in as the owner's
  account so the real game, not the demo, is on screen; then sign out for
  the demo pass.
- Test data: a puzzle must exist for today. If none does, press Hurry-Up
  once, which generates it inline. For the podium and board rows, seed
  through the service role (a one-off SQL in the Supabase MCP, inserting
  completed hurry_up attempts for three to six test users for today with
  distinct totals) and delete those rows at the end of the pass; record the
  SQL used under the task.

### 23A.2 The four widths

| Device | Width | Height |
| --- | --- | --- |
| phone | 390 | 844 |
| tablet | 768 | 1024 |
| laptop | 1280 | 800 |
| desktop | 1536 | 960 |

Chrome on this machine will not resize its main window under about 500 px
and the site refuses to be framed, so the phone and tablet widths are
reached with a script-opened popup: inject a button with the JavaScript
tool whose click runs `window.__p = window.open(path, "ffbpop", "width=390,height=844")`,
click it with the computer tool (window.open needs a user gesture), then
drive the popup from the parent tab: `window.__p.resizeTo(768, 1024)` to
change width, `window.__p.location.href` to move, `window.__p.document.querySelector(...).click()`
to press buttons, and measure with `getBoundingClientRect`,
`scrollWidth - innerWidth` for horizontal overflow, and `window.innerWidth`
to confirm the width actually took. Do a resize and a measurement in
separate calls. Screenshots show only the main tab, so phone and tablet
results are MEASUREMENTS, and the report says so; laptop and desktop are
screenshots plus measurements. (This is the method recorded in the
project's memory file reference-chrome-screen-size-checks.)

### 23A.3 What is exercised at EVERY width

Signed in:
1. Idle page: hero, mode picker, boards, record, Yesterday (seed one
   completed attempt dated yesterday for the owner to show it).
2. Start Hurry-Up. On each of the five prompts: the clock badge counts, the
   combobox opens and shows headshots, arrow keys move, Enter commits,
   Answer submits, the reveal shows headshot, count-up, tier chip, the
   marker flight with the kick trail, the room bars, Next. Let one prompt
   time out on purpose and confirm the timeout reveal.
3. Completion sheet: total, strip with every marker labeled, letter tiles,
   stats strip, Copy result (read the clipboard text back and compare to
   section 14), Copy page link, Replay in Film Room.
4. Film Room: start, Skip, End practice, resume after a reload mid-prompt.
5. Boards: podium with three metal tones, rows from rank 4, your-rank
   strip, switching board and page, a Signal profile link on a row.
6. Reload during a Hurry-Up prompt and confirm the clock resumes from the
   server's remaining time, not from 30.
7. Keyboard only, once per width: Tab order through the picker, the
   combobox, Answer, Next, the copy buttons; focus visibly lands on the
   prompt heading, the result heading and the completion heading.

Signed out:
8. The demo with and without the clock, the native select, the Sample
   ribbon, the sign-in call to action.

### 23A.4 What is measured and must be true at every width

- `document.documentElement.scrollWidth - window.innerWidth` is 0 on every
  view (no horizontal overflow). The site header's known 20 px overflow at
  374 px is pre-existing and is not this game's; at 390 it does not occur.
- Every interactive element's bounding box is at least 44 by 44 CSS px.
- Exactly one h1; heading levels do not skip.
- Every figure named in section 18A.3 is present as text (the big number
  and its sr-only unit in one element).
- The field strip's `<ol>` record list is present and readable under the
  strip at every width.
- Nothing from the desktop layout is missing on the phone: boards, record,
  Yesterday, the podium (stacked), the room bars, the copy buttons.
- The clock badge, the mode tickets, the podium and the completion sheet
  look intentional at 390 px: no clipped text, no wrapped single words, no
  overlapping markers on the strip.
- Under the OS reduced-motion setting (toggle it once, laptop width): no
  flight, no flash, no count-up, no pulse; the ring stays full.

### 23A.5 Output

A table in progress.md under LS-T060a: one row per (view, width) with
pass or the defect found and the fix. Every defect is fixed before LS-T061
starts. Screenshots at laptop and desktop of the idle page, a reveal, the
completion sheet and the podium are saved under data/long-shot/device-pass/
with the width in the file name. Then the gate is re-run.

---

## 24. Launch checklist (owner, after deploy)

- pg_policies lists every long_shot_ table with its policies; anon probe
  returns zero rows on every table; authenticated probe returns own rows
  only on attempts, answers and stats, nothing on puzzles, prompts and
  tallies, and a permission error on stats.hidden_reason.
- View-source of the game page while a prompt is on screen contains no
  player name from the answer set and no tally; the answer response body
  contains no next prompt text.
- A second browser tab submitting the same position returns 409 stale_prompt.
- An answer posted 33 seconds after /next (30 + 2 grace + 1) scores 0 and
  is marked timed_out; the clock did not start at the previous answer.
- A retired player who is a correct answer to a historical prompt can be
  found in the combobox.
- A Film Room completion changes no row in long_shot_user_stats and no
  tally.
- Running settle twice for the same date changes no total.
- A user with a live Signal profile shows as a link on the board; the same
  user after setting visibility private shows as text on the next cache
  refresh.
- Lint zero errors and zero warnings; every new file passes the ASCII rule.

---

## 29. What the commit change added (2026-11-07)

Section 0 item 3 reversed by the owner: the build agent commits and pushes
once to main when the whole build is finished (LS-T063), with the commit
rules spelled out (main only, one commit, owner's voice, no attribution,
retry on network failure, rebase if main moved). LS-T062 now also moves the
plan to docs/completed/ and updates docs/README.md before that commit.

## 28. What the device-pass addition added (2026-11-07)

Section 23A and task LS-T060a: before the single review, the build agent
plays every view of the game in Claude in Chrome at 390, 768, 1280 and 1536
px, using the popup method from the project's memory for the two widths
Chrome will not resize to, exercising every flow signed in and signed out,
measuring overflow, tap targets, headings and figure text, checking reduced
motion, fixing every defect and recording a per-view table and screenshots
under data/long-shot/device-pass/. Section 0 item 6 orders it before
LS-T061.

## 27. What the design pass added (2026-11-07)

Decisions 12 and 13. Section 18A: the field-strip signature graphic with its
pure geometry module; the single stage with stadium-light gradients and no
nested boxes; the tier color ramp and the big-number type scale; the Long
Shot SVG mark drawn in code; a custom hero replacing the masthead; the two
mode tickets; the clock badge with a depleting ring; the result reveal with
count-up, strip landing and room bars; the completion sheet with letter
tiles and a stats strip; the gold, silver and bronze podium with AA metal
tones; the Settled stamp, the Lone Signal pulse, the record grid; the demo
ribbon; the motion rules. New tasks LS-T039 and the Phase 4 rewrites, new
tests for geometry and tier style, and the components/long-shot/ module
map entry. Added afterwards at the owner's request: the kick trail, the
one place NFL team colors appear (a two-tone comet tail behind the flying
marker for one second, a single end-zone flash on a Long Shot, a fading
two-color ring under reduced motion), with the colors read server-side
from nfl_teams and carried only inside the answer response.

## 26. What the third read added (2026-11-07)

Section 0, the build agent protocol: progress.md and handoff.md after every
task, no commit or push, no questions, one reviewer sub-agent at the end
replacing the per-phase reviews. Decisions 8 to 11 made unconditional.
Section 5.1a, which main panel renders after a completed or abandoned
Hurry-Up. Film Room attempts can be ended by the player and are closed by
the cron after 24 hours; at most one active attempt per user. The zero-prompt
day (`puzzle_unavailable`). A restart on a finished Hurry-Up returns the
finished attempt. The generate cron also fills a missing today. The
"Skipped" sentence, the remainingMs clamp, the days_played and
best_day_points rules, the generic client error, the dry-run task number.

## 25. What the second read added (2026-11-07)

Security: the next prompt's clock starts only when Next is pressed, through
/next alone (8.2, 17.4); Long Shot has its own search pool so retired
players, the long_shot tier of a historical prompt, can be typed (17.5,
7.4); the moderation note on user stats is revoked from the owner (15.6);
rate buckets for /next and /state (17); the admin's view of today's answers
is behind a closed disclosure and recorded as decision 10; attempt_closed
and attempt_active states; second accounts recorded as decision 8; families
4 and 5 name their source.

Data integrity: completion keyed on prompt_count so a short puzzle
completes (16.3); settlement idempotent per attempt with the lone_signals
stat actually written (10.3); the streak reset runs in the settle cron
(10.3, 12, 13.1); stats recording anchored on stats_recorded_at and healed
from page state (12, 15.4); the repair path for a crash between the two
answer writes, and base_points always recomputed (9, 17.3); an active
attempt is resumed across the Eastern midnight flip (5.5); the timer reads
the frozen timer_seconds (8.2); regeneration refuses any attempt in either
mode and uses a seed salt (7.1, 17.8); the roster-rate season is chosen by
denominator size (7.5); the rate-0 tie behavior is stated and printed by
the dry run; the unsettled Yesterday state (10.4).

Accessibility: one focus target per state (18.1); the countdown is visible
text outside a live region rather than aria-hidden (8.3); the demo has a
no-clock choice and a native select (11); the 2.2.1 basis is recorded as
owner decision 9; one live region per event (18.1); a named result heading
(5.3); a configurable debounce and an 8-option listbox cap (18.3); the
timeout focus move (8.3).

Performance: inline generation only inside the attempt route with
maxDuration 60, never in a render (6, 5.2, 17.2); ordered paged reads on
the season index (7.2); cache keys carry the requested date and the
exclusion set (13.1); the completed-week test uses a row-count share so a
Thursday game is not a week (7.2); the current season is drawn only when it
has a completed week (7.2).

Reliability: a text copy button instead of the image share strip (14);
combobox tests written rather than assumed (18.3); the real format slug
redraft-ppr-std and skip rules for families 4 and 5 (7.2); behavior for
film_room_enabled and leaderboards.enabled (5.2, 8.1, 13.1); no_puzzle copy
(17.2); Film Room room-line wording (5.3); cron time budgets and the settle
stop rule (17.6); recordTimeout as one function (8.2); the client error
state list (18.2); short-day wording (3, 5.4); the sitemap and llms test
locations (19); the analytics shape (19); SearchPlayerResult moved to the
shared component (18.3); the season_finish union limited to cutoffs 5 and
12 (7.2); settleNow idempotent (17.8).

---

## 30. What shipped differently (2026-11-08)

Every departure from this plan, with the reason. Each is also recorded under
its task in progress.md.

- Seven migrations, not six. 0369 (`long_shot_atomic_writes`) came out of the
  LS-T061 review: puzzle and prompts are written in one transaction
  (`long_shot_insert_puzzle`), the stats anchor and upsert land together
  (`long_shot_record_completion`, so a failed write heals), settlement's guard,
  Lone Signal marks and bonus land together (`long_shot_settle_attempt`), and a
  partial unique index enforces one active attempt per user.
- 15.6: the column privacy on `long_shot_user_stats` is a table SELECT revoke
  plus a column-list grant. The plan's column revoke alone does nothing while a
  table-level grant exists.
- 8.1 and 17.2: before today's Hurry-Up is over, Film Room plays the most recent
  SETTLED past day, not merely the most recent past day, because an unsettled
  day can still have a Hurry-Up open past midnight (5.5) and Film Room's room
  figures would show its most given answers.
- 18.3: the shared combobox prop is `showTeamLogos`, not `showHeadshots`.
  Signal Scout already shows a 28 px headshot and had to stay unchanged; the
  flag adds the 14 px crest. The search prop returns `{ ok, results }` or
  `{ ok: false, code }` so a rate-limited answer keeps prior results. The
  combobox test covers exported pure helpers, because the repo has no DOM
  testing library.
- 7.5 and 20: `assignTiers(entries, cutoffs)`; points are applied by `pointsFor`
  at scoring time, since the stored answer entry carries tier and rate only.
- 7.2 family 2 reads "against the {team name}". Its three yardage phrases were
  not written in the plan and read "had 75 or more rushing yards" and so on.
  The touchdown arm is an or() on rush_td and rec_td.
- 7.2 family 6 reads roster rates from the qualifying rate season (7.5) rather
  than literally the current season.
- 17.6: the 90-day tally prune reads old prompt ids and deletes in chunks,
  because PostgREST cannot delete through a subselect, and it prunes only
  puzzles 90 to 120 days old so the nightly read stays bounded.
- DTOs carry a `kind` discriminator. `PromptDto` adds the running base score,
  the answered summaries (for the small strip) and the frozen `timerSeconds`;
  `AttemptDto` adds `hasPending`. A resumed attempt whose prompt is already on
  the clock is fetched at once; one with no pending prompt shows a Continue
  panel, so a reopened tab never starts a clock unasked.
- 5.2 and 18A.6: the mode picker reads the admin timer ("30 seconds a prompt"),
  the 18A.6 form, rather than the word "Thirty". After today's Hurry-Up is over
  the picker offers Film Room alone.
- 5.3: a timeout or skip has no answer to count, so its room line reads
  "{total} players have faced this prompt."
- 11: each demo prompt offers its own 30 candidates; one shared list of 30
  could not hold the 33 answers.
- 14: `CopyLinkButton` gained an optional `onCopied` so `long_shot_share` fires
  only after a copy lands. The completion sheet also shows the share text.
- 18A.1: the kick trail is two halves 14 units tall at the marker (28 together)
  spanning the flight, scaled in from the line in step with the marker. Misses
  and unanswered prompts share one group at the line, and a sweep keeps every
  marker a full spread from its neighbor. The end-zone flash is one 600 ms
  keyframe in app/globals.css.
- 19 point 4: the games page cost detail now reads "Accounts are free too".
  Point 5: the homepage games grid gains a third column from lg.
- 23: LS-T046 (the agent's own page pass) ran inside LS-T060a on the
  production build rather than as a separate dev-server pass first.
- 23A: the signed-out demo was checked by fetching the page HTML without
  cookies rather than by clicking through it, because signing out would have
  ended the owner's session. Reduced motion was not toggled in the browser,
  because changing the OS setting is outside what the agent may do; the code
  paths are listed under LS-T060a.

### Post-ship review (2026-11-08, LS-T064)

The owner asked for a full second review of the shipped build and one change
of behavior. Each departure below supersedes the section it names.

- 11 and 18.3, owner decision: the demo's native `<select>` is gone. On a
  phone it was a list a visitor could scroll through and pick from, which
  defeats the point of a recall game. The demo now uses the shared
  `PlayerGuessCombobox` over its shipped candidate list, filtered locally by
  `searchDemoCandidates` (name, first-name or surname prefix), still with no
  network call. In the game and the demo alike the picker shows nothing until
  `SEARCH_MIN_LENGTH` (4) letters are typed, and the search route enforces the
  same floor (`MIN_QUERY_LENGTH`), so the picker is a typeahead and never a
  browsable list. The help text says so. This replaces the "minLength = 2"
  in 18.3 and the native-select paragraph in 11.
- 18A.1: the end-zone lettering sits at x 988, the end zone's right edge,
  because at x 950 a Long Shot marker landed on top of it. The small strip
  is pinned to the left of its box (`xMinYMid`), because a height-capped SVG
  centered itself and sat offset from the record list under it.
- 13.1: `LeaderboardView` carries `viewerHidden`. A reader in the exclusion
  set (an admin while `hide_admin_users` is on, or a hidden user) still sees
  their own rank, and the strip now says their row is kept off the public
  board. When a reader has a rank but the shared rows are empty (the board
  is cached for a minute), the panel says the board refreshes within a
  minute instead of "nobody has finished".
- 18.2: one answer is in flight at a time. The clock reaching zero while an
  Answer request was still out sent a timeout for the same prompt, received
  stale_prompt and served the next prompt over the reveal. A failed timeout
  submission now shows the reload sentence rather than "Press Answer again",
  because there is no Answer to press.
- 17.7 and 17.8: a `date` is validated as a real calendar date
  (`isValidGameDate`), not only by shape; `2026-13-45` was a 500.
- 17.4: a well-formed uuid that is not a player (a foreign-key failure on
  the answer row) answers 400 `invalid_request` and leaves the prompt pending.
- 9: the room's tally read is chunked at 200 ids, because `max_answers` can
  be set to 500 and an `in()` of that many uuids is a GET over 18 KB.
- 5.1a: the closed-unfinished panel counts answered prompts only; the
  timeouts the night records are not "prompts you scored on".
- 18A.1: the marker flight effect keyed on the flight object, which the
  result panel rebuilt on every count-up frame, so the flight restarted for
  the whole count-up; it keys on a string now.
