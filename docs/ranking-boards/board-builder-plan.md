# Beacon Ranker (head-to-head rankings board builder)

Status: plan complete, awaiting approval to build. Research 2026-09-25; the
owner answered three rounds of questions the same day (section 3). Revised the
same day after a code review of the plan (corrections in section 2, the run
model in section 8, the merge in section 9.2, the design pass in section 13).
Nothing built. No code, schema or copy has changed. Section 12 lists what is
still open.

## 1. The idea

Building a board in My Beacon today means one of two things: start blank and add
players one at a time, or import our rankings and then drag players around. Both
work. Neither is pleasant past the first thirty players.

The builder replaces that with a guided run. The reader picks what to start
from, then answers one question at a time: which of these two players would you
rather have? The board assembles itself from the answers. Dragging, the up and
down buttons and the add box all stay; the builder is a faster way to reach the
same board.

## 2. What exists today

Survey of the current code, 2026-09-25.

- Pages: `app/my-beacon/rankings/page.tsx` (list and create) and
  `app/my-beacon/rankings/[boardId]/page.tsx` (editor). The editor is
  `board-editor.tsx`, a 1,729 line client component. Drag and drop is native
  HTML5 events on each row; there is no drag library in the project.
- Storage: `user_ranking_boards` and `user_ranking_board_players`
  (migration 0056, then 0058 and 0064). Order is an integer `rank_position`
  per row, 1-based, unique per (board, player). Tiers are a nullable integer
  per player row plus `tier_count` and `tier_labels` on the board, up to 30.
  The per-row `tier` is read by `components/signal/board-view.tsx`,
  `orderBoardForDisplay`, `computeBoardRanks`, the import route's response and
  the editor's tier select. Section 7 sequences its removal around those.
- Writes: server actions in `app/my-beacon/rankings/actions.ts`.
  `saveBoardPlayers` deletes removed rows and upserts every remaining row with
  a fresh rank, capped at 2,000 players, debounced 700 ms from the editor.
  Every action requires a signed-in user. There is no rate limiting and no
  guest concept anywhere in the feature.
- Scope: `overall` or one of QB, RB, WR, TE, K, DEF. The list is hard-coded in
  a CHECK constraint (0056 lines 30-31) and in `lib/ranking-boards.ts`. There is
  no defender scope. The player search pool already has an opt-in for
  defenders, `searchFantasyPlayers({ pool: "ranked+idp" })`, gated by
  `idpRelevantPlayerIdSet` (20 or more snaps last season, or a depth chart
  slot), and `lib/player-search.pool.test.ts` deliberately asserts that the
  board editor does not use it. Widening the editor means removing that
  assertion on purpose, not building a new pool.
- Source and format: a board stores neither. They matter only to "Import our
  current rankings", which has its own source and format selects and does NOT
  go through `resolveSourceSlug` / `resolveFormatSlug`. The import route
  (`app/api/rankings/import/route.ts`) does filter sources on
  `data_type = "rankings"` through `resolveSourceForFormat`, reads `rankings`
  ordered by `overall_rank` capped at 1,000 rows, and REQUIRES A SIGNED-IN
  USER plus a custom request header. A guest cannot use it as a seed source,
  which section 8 accounts for.
- The FF Beacon source: slug `ffbeacon`. Its `source_registry` row was
  inserted with `is_active = false` in migration 0036 and no migration
  activates it; the site default (`is_default`, migration 0053) was seeded to
  KTC. Both may have been changed in the admin panel since. CHECK IN
  PRODUCTION BEFORE BUILD which source is active and which is default,
  because the wizard default (section 5.1) and the comparison (section 6)
  both read `rankings` rows under `ffbeacon`.
- The `rankings` table holds ONE current season, one row per (player, format,
  source, week, season), with `overall_rank`, `position_rank` and `tier`.
  There is no history. Any comparison against FF Beacon is therefore against
  today's rank, never the rank on the day a board was built, and the UI says
  so.
- Sharing: public boards render at `/{handle}/rankings/{boardId}` with an OG
  card, and featured boards show on the Signal profile. The page is a thin
  wrapper around `components/signal/board-view.tsx`, which the `/u/{handle}`
  route shares, so anything added to the public board (tier breaks, the two
  comparison figures) is added once. The OG route
  (`app/api/og/board/[handle]/[boardId]/route.tsx`) shows the scope and the
  top five players, no tiers.
- Discoverability: every link to the feature is inside the signed-in area.
  Nothing on the home page, `/tools` or `/games` points at it.
- Naming collision to keep in mind: "Rankings Board" in `SEARCHABLE_TOOLS` is
  the public `/rankings` page, and "Rankings Boards" in the rail is the personal
  one in My Beacon.
- Accessibility gap: the per-row "Move up" and "Move down" buttons change the
  order without announcing it.

Source coverage, checked against production 2026-09-25:

| Source | Formats ranked | Defender rows |
| --- | --- | --- |
| FF Beacon (default) | 11: redraft, dynasty and best ball, all PPR, with superflex and TE premium variants | 0 |
| KTC | 5 | 0 |
| FantasyCalc | 6, including half PPR and standard | 0 |
| DynastyProcess | 2 | 0 |

Two consequences: no source can seed a defender run (section 5.3), and FF
Beacon has no half PPR or standard rankings, which affects the comparison in
section 6.

Pieces the builder can reuse: `components/player-headshot.tsx` (builds the
image from the Sleeper id in `external_ids`; there is no headshot column),
`components/position-chip.tsx`, `components/nfl-team-logo.tsx`,
`player_positional_finishes` through the FAAB `loadPositionalFinishes` in
`lib/faab/league-load.ts` (the one that takes a scoring argument; the profile
version in `lib/player-profile.ts` returns every scoring kind), age computed
from `players.birth_date`, the Sleeper identity card
(`components/sleeper-handle/identity-card.tsx`) as the pattern for the source
and format card, Would You Rather's two-sided board and its guest cookie
(`lib/would-you-rather/identity.ts`: httpOnly, server-minted UUID, one year),
`lib/rate-limit-claim.ts claimRateLimitSlot` and
`lib/rate-limit-actor.ts resolveRateLimitActorKey` for metering,
`lib/format-fallback.ts pickFallbackFormat` for the nearest-format lookup, and
the import route's query as the model for the seed list loader.

## 3. Decisions (owner, 2026-09-25)

1. Placement: a public tool page plus a "Build by comparing" mode in the board
   editor.
2. Scope: boards cover every player and position, defenders included. Offense
   is the default; defenders are one switch away rather than hidden.
3. Guests: a signed-out reader can build a whole board. Saving it requires
   signing in. Guest boards are deleted 48 hours after their last change, and
   the page says so.
4. Rank comparison: a player's FF Beacon rank is NOT shown while the reader is
   choosing. Once he is placed, the page shows how the reader's placement
   compares with FF Beacon's: an up or down arrow and a number of spots.
5. Provenance: a board remembers the source and format it was built from.
6. Community rankings: yes. Everyone's boards merge into a community board.
7. Name: a brand name for the tool, but the URL, title, headings and copy carry
   the search phrases, the way Trade Calculator carries Signal Check.
8. (Explained in chat; see section 8.)
9. Depth: top 100 by default for overall boards, top 24 for one position. The
   reader can raise the limit.
10. (Explained in chat; see section 5.2.)
11. The builder runs on any board, including one that already has players.
    The reader can start from the top or from a chosen spot.
12. Tiers are managed inside and outside the builder, and change from a tier
    number on each player to tier breaks: a line drawn after a rank.

Second round, same day:

13. Guests can only build. A guest board is saved server side so it can become
    a real board when the guest signs in, but a guest cannot share it, publish
    it, feature it on a profile, edit tiers, or do anything else an account
    can (section 8).
14. Faster climbing: after three straight wins, the reader is asked whether to
    place the player at a rank they choose or keep comparing one at a time. No
    halving search (section 5.2).
15. Name: Beacon Ranker.
16. URL: chosen by research (section 4).
17. Defender seed order: our projected season points first, last season's
    points as the fallback.
18. A tier break stays at its rank when players move, and the reader can move a
    break easily.
19. Community board inclusion: every board, with a per-board opt-out that is
    quiet (a side control or hint card, not a prompt).
20. Community board eligibility: a board counts when it ranks at least 50
    players (overall, all offense or all defense) or at least 12 (one
    position). The merge must handle boards that rank different pools of
    players (section 9).

Third round, same day:

21. Community rankings as a site-wide source: yes eventually, off at launch.
    Build the community board so that becoming a source later is a small step,
    without building the source half now (section 9.4).
22. Community page at `/rankings/community`, with internal links to it and to
    the builder from wherever they fit (section 4.1).
23. Community settings start at 5 boards per player and 25 counted boards per
    format.
24. Depth is a default, not a limit, for signed-in readers: top 100 overall and
    top 24 per position to start, raised whenever they like. Guests are capped
    lower: top 12 for one position, top 48 for a board of several positions.
    Going past the cap opens a designed prompt to sign up or log in, which
    keeps the board so far (section 8).

## 4. Name, URL and where it is listed

Brand name: Beacon Ranker (owner's choice). One thing to know: a competitor
called FF Ranker (ffranker.com, title "Create Your Own Fantasy Football
Rankings") ranks for this exact search. "FF Beacon's Beacon Ranker" and "FF
Ranker" sit close together in a results page. Not a reason to change the name,
but a reason for the page title to lead with the keywords and carry FF Beacon's
own name, so the two are not confused.

Everything a search engine reads uses the keywords, with the brand second, the
same split as the Trade Calculator.

URL: `/tools/custom-rankings`. Research, 2026-09-25:

- Google's own guidance on URL structure asks for readable words, hyphens
  between them, and URLs that are simple and intelligible to humans. It sets
  no preference for exact keyword phrases.
  (developers.google.com/search/docs/crawling-indexing/url-structure)
- Google's John Mueller has described words in a URL as a "very, very
  lightweight" ranking factor, used mostly before a page's content has been
  crawled, and not worth restructuring a site for. (Search Engine Roundtable,
  seroundtable.com/google-words-url-very-light-weight-factor-31081.html)
- The pages that rank for "custom fantasy football rankings" today use short
  slugs: Draft Punk at `/custom-rankings/`, RotoWire at
  `/football/rankings-custom.php`, Cheatsheet War Room at
  `/create/custom-sheet.aspx`, FF Ranker at its home page. None uses the full
  phrase.
- What the slug does affect is how the link reads where people paste it:
  Discord, Reddit, group chats. A short, plain slug reads cleanly there.

So the long exact-match slug buys close to nothing, and the short one reads
better where the link actually travels. "Custom rankings" is the core of the
biggest phrase in the cluster, and "fantasy football" is carried by the title,
the H1 and the copy, which is where Google weighs it. This replaces the earlier
`/tools/custom-fantasy-football-rankings` suggestion.

- Title: "Custom Fantasy Football Rankings Builder | Beacon Ranker by FF
  Beacon" (trimmed to "| Beacon Ranker" if it runs long in results).
- H1: "Build your own fantasy football rankings".
- Meta description names "custom rankings", "make your own", "tiers" and
  "rank players head to head".
- Nav label: "Rankings Builder". Nav hint: "Beacon Ranker: rank players two at
  a time".
- Entries in `TOOLS_NAV`, `SEARCHABLE_TOOLS` (keywords: custom rankings,
  rankings builder, tier list, cheat sheet, draft board, rank players),
  `lib/tools-catalog.ts`, the nav-tree icon map and llms.txt.
### 4.1 Internal links

Each link uses descriptive anchor text with the phrase the target page is
meant to rank for, never "click here". Each is a real `<a>`, so it is
crawlable and works without JavaScript.

Into the builder (`/tools/custom-rankings`), anchor text along the lines of
"build your own fantasy football rankings" or "custom rankings builder":

- The public rankings page `/rankings`: "Disagree with these? Build your own
  rankings", near the top, not in the footer.
- Every public board page `/{handle}/rankings/{boardId}`: a line for visitors,
  "Build your own board like this one". Shared boards are the most likely page
  to arrive from outside the site, so this is the highest-value link.
- The community page.
- Player profile pages: "Rank him yourself" beside the player's rankings.
- The My Beacon rankings list and the empty state of a new board.
- The tools index, the site search entry, the footer Tools column (all through
  `TOOLS_NAV`), and a card in the home page's tool section.
- Relevant guides and Beacon Brief articles about rankings or tiers, as a
  contextual link inside the text where it reads naturally.
- `llms.txt` and `llms-full.txt` through the tools catalog.

Into the community page (`/rankings/community`), anchor text along the lines
of "community fantasy football rankings":

- The builder page, and the end of every finished run: "See how everyone else
  ranks them".
- The public rankings page, beside the source picker, once the page is
  published.
- Player profiles: "Community rank: 14th, on 38 boards", linking to the page.
- Every board's "vs community" figure.
- The sitemap once published.

Before a format's community board publishes (fewer than 25 counted boards), the
page exists and says so honestly ("12 of the 25 boards needed so far. Build
yours to help"), is marked `noindex` so a near-empty page is not indexed, and
the links into it that promise data (player profiles, "vs community") stay
hidden. The links that invite contribution (the builder page, the end of a run)
show from the start.

Breadcrumbs: Tools, then Rankings Builder; Rankings, then Community.

## 5. The flow

### 5.1 Setup (the wizard)

1. Start from which rankings. Defaults to the reader's resolved source and
   format (`resolveSourceSlug`, `resolveFormatSlug`, so whichever source is
   `is_default` in production; see the check in section 2), shown as a card in
   the style of the Sleeper identity card: "Starting from FF Beacon, Dynasty
   Superflex. Change". Change opens Source and Format controls with the same
   gating rules as the header (Format hides unsupported entries, Source warns
   before a format switch), but they are BOARD-LOCAL: a choice here is written
   to the board and never to the reader's cookie, `user_preferences` or URL.
   Picking KTC to seed one board must not switch the whole site to KTC. The
   controls are a separate instance of the picker components with the persist
   step left out, not the header's instance.

   What the board stores (decision 5): `format_config_id` (a foreign key to
   `format_configs`, the same column every format-dependent table uses) and
   `seed_source_slug` (text, the `source_registry` slug the seed came from).
   The format is what the board MEANS and drives the community merge, the
   comparison and the finishes column; the seed slug is provenance only. The
   existing import dialog writes both as well, so a board imported without the
   builder carries a format and can count toward the community board without
   the one-time prompt in section 9.1.
2. Which players. Overall (offense), one position, or all defenders. Beside the
   overall choice, a short hint and a switch: "Include defensive players (IDP)".
   Single defender positions (DL, LB, DB) appear in the position list.

   Scope values, decided now because the CHECK constraint, decision 20 and the
   community merge all key on them. `scope` gains `DL`, `LB`, `DB` and
   `defense` (every defender). `overall` keeps its meaning of every offensive
   position; an overall board that includes defenders is `overall` with a new
   boolean `includes_defenders` on the board, rather than an eighth scope
   value, so the community merge (section 9) and the "one board per account
   per (format, scope)" rule treat the two as the same scope with a wider
   pool. There is no separate "all offense" scope: that is what `overall`
   already is. `scopeLabel`, `scopeDescription`, the profile board list, the
   OG card and `profile_top_n` all need the new values.
3. How deep. For a signed-in reader this is a starting point, not a limit
   (decision 24): top 100 for overall or defense, top 24 for one position,
   editable in the wizard and raisable at any time. A finished run offers
   "Keep going: next 25". Depth counts PLACED players: a player the reader
   leaves off does not use a slot, and the next seed player is pulled in so
   the board still reaches the depth. A guest's wizard defaults to the guest
   cap (48 or 12, section 8) rather than showing a number they cannot reach.
4. When run on a board that already has players: "Start from the top" or "Start
   from rank N" (section 5.4).

### 5.2 The comparisons

- The seed list is the chosen rankings in order. The first question is seed
  players 1 and 2. The winner is rank 1, the other rank 2.
- Every later question brings in the next seed player and asks about him
  against the player at the bottom of the board.
  - If the reader keeps the player already there, the newcomer takes the next
    spot and the run moves on.
  - If the reader prefers the newcomer, the two swap and the newcomer is asked
    about against the player directly above, climbing until the reader keeps
    the player above. Then the run moves on.

This is insertion sort, and it suits a list seeded from real rankings: a
reader who mostly agrees answers about one question per player.

Faster climbing (decision 14). If a newcomer wins three questions in a row, he
is probably headed well up the board, and asking about him one spot at a time
could mean 100 or more questions about one player. (Three is the starting
value of a `winsBeforePrompt` setting in the community settings row, section
9.3, so it can be tuned without a deploy. A newcomer who beats the player at
rank 1 is simply placed first; no prompt is needed.) At that point the run
stops and asks the reader to choose:

- "Place him at a rank": the reader enters or picks a rank, he goes there, and
  everyone from that rank down moves down one. The run then moves on to the
  next player. No further questions are asked about him.
- "Keep comparing one at a time": the single-question climb continues. The
  choice is offered again after each further three straight wins, so a reader
  who picked this once is not locked into 80 questions.

The rank control accepts only ranks above his current spot, and shows who is at
the chosen rank now ("Rank 8 is currently Chris Olave") so the reader knows who
moves down. Its label and that line are read together by a screen reader.

A "Put him at..." control is also on every question for a reader who already
knows, without waiting for three wins.

Controls on every question: Undo, Skip (the newcomer stays where he is, below
the player he was being asked about, and the run moves on), Leave him off
(remove him from the board and pull the next seed player), Save and stop.

Progress reads "Player 37 of 100". The total number of questions cannot be
predicted, because it depends on the answers.

### 5.3 Defenders

No source ranks a defender, so there is no seed list to start a defender run
from. The seed order is ours (decision 17):

1. Projected points for the rest of the season, read through
   `lib/projections/read.ts loadAdjustedProjections` with `defendersOnly`,
   the remaining weeks as the window, and the idp123 preset
   (`lib/idp/scoring-presets.ts`) as the scoring. That read names its
   projection source through `resolveProjectionSourceForWindow`, per the
   projection engine rules, and returns our ADJUSTED figure (opponent and
   reliability applied), not the engine's raw number. For an ordering either
   would do; the adjusted one is used because it is the number the rest of
   League Pulse shows, and the seed line says "projected points".
2. Where a defender has no projection, last season's points under the same
   scoring, from his stat lines through `lib/idp/stat-line.ts`. Out of season
   the remaining-weeks window is empty, so every defender takes this path and
   the seed line says "last season's points" for the whole list.
3. A defender with neither (an undrafted rookie, say) is not seeded. The reader
   can still add him by hand.

A defender is never scored from the stored `pts_*` columns, per the IDP rules.
The seed list says in words which of the two figures ordered it.

On an overall board with defenders switched on, offense and defense have no
common scale to interleave from, so defenders join as a second pass: once the
offensive run is done, each defender enters at the bottom of the board and
climbs. A reader who rates no defender above their 90th offensive player
answers one question per defender, and the three-win prompt lets a reader place
a highly rated linebacker directly.

Wherever a value would appear for a defender, the words "No market value"
appear instead, never a zero, per the IDP rules.

### 5.4 Running on an existing board

- Start from the top: every player on the board is re-checked in its current
  order, then seed players not yet on the board are brought in up to the depth.
- Start from rank N: ranks 1 to N-1 are kept as they are. Players from rank N
  down are re-checked in their current order, then new seed players follow.
  A player being re-checked may still climb above rank N; the start point only
  means the top of the board is not asked about again from scratch.

### 5.5 The card

Two players side by side on desktop, stacked on mobile, drawn identically so
neither side looks like the default. For each: photo, name, position, team,
age, and the last three positional finishes in the scoring that matches the
chosen format. A rookie shows "Rookie, no NFL finishes". No source rank on the
card (decision 4). Section 13 specifies how it is drawn.

## 6. Compared with FF Beacon

Once a player is placed, the result line and the board both show where FF
Beacon has him:

- On placement: "Wilson placed 14th. FF Beacon: 18th. You're 4 spots higher."
  An up or down arrow sits beside it for the eye; the words carry the meaning
  and the arrow is `aria-hidden`.
- On the board, in the editor and on the public board page: a "vs FF Beacon"
  figure on each row ("4 higher", "2 lower", "Same"), with the arrow.
- A position board compares with FF Beacon's positional rank, an overall board
  with its overall rank.
- The comparison is always against FF Beacon, whatever the board was seeded
  from. This is a deliberate exception to the Source and Format Sync rule
  (the source shown is not the reader's chosen one), and it goes into
  CLAUDE.md beside the feature when it ships, so a later review does not flag
  it as a defect.
- It is always against FF Beacon's rank TODAY. `rankings` keeps one current
  season and no history (section 2), so a board built in August compared in
  October shows October's gap. The figure's label says "vs FF Beacon today".
- FF Beacon has no half PPR or standard rankings. For those formats the
  comparison uses FF Beacon's nearest format through the existing fallback
  chain (`lib/format-fallback.ts`) and names it: "vs FF Beacon, Redraft PPR".
- Defenders: "Not ranked by FF Beacon".
- A player FF Beacon does not rank in that format: "Not in FF Beacon's
  rankings".
- Older boards with no stored format compare on the reader's current format,
  labelled.

## 7. Tiers: tier breaks

Today a tier is a number on each player. There is no way to select a run of
players and put them in a tier afterwards, and dragging a player gives him the
tier of the row he lands on.

Replacement: a tier break is a line drawn after a rank. Tiers are numbered from
the top, in order, by the lines.

Example, a 24 player RB board:

- Break after rank 2: ranks 1-2 are tier 1, ranks 3-24 tier 2.
- Add a break after rank 10: ranks 1-2 tier 1, 3-10 tier 2, 11-24 tier 3.

(The owner's example numbered these tiers 2, 3 and 4; read here as 1, 2 and 3,
since tiers count down from the top.)

A break stays at its rank number (decision 18). If a break sits after rank 2
and the reader drags the 5th player to 1st, the old 2nd player becomes 3rd and
drops into tier 2; the line did not move, the players did. If the board gets
shorter than a break's rank, that break is removed and the reader is told.

In the editor: ONE "Add tier break after rank..." control above the board (a
number field that names the two players the line would fall between before
it is applied), plus an "Add tier break below" action in each row's menu for
a pointer or a reader already on the row. Not a button between every pair of
rows: on a 200 player board that is 199 stops in the tab order before the
first player. Every break has its own controls:

- Move up one and Move down one buttons, which shift the line a single rank
  and announce the result ("Tier 2 now starts at rank 4, Garrett Wilson").
- "Move to after rank..." for a longer move, a number field that states which
  players would then sit on each side of the line before it is applied.
- Drag, for a pointer. Never the only way.
- Remove.

Labels ("Elite", "Weekly starters") attach to a tier and stay optional.

In the builder: the board-so-far list has the same control, and a finished run
offers an optional tier pass that asks one question per gap: "Is there a real
drop-off between Bijan Robinson (2nd) and Jahmyr Gibbs (3rd)?" Yes draws a
break. The reader can end the pass whenever they like.

Storage: `tier_breaks integer[]` on `user_ranking_boards` (each value is the
rank a line falls after), replacing the per-row `tier` column. The per-row tier
is derived for display. `tier_count` becomes derived too (breaks plus one) and
is dropped with `tier`; `tier_labels` stays, indexed by derived tier number,
and `MAX_TIERS = 30` becomes a cap on the number of breaks (29). The
migration converts existing boards by drawing a break wherever the stored tier
changes between two adjacent rows, so a board whose tiers were out of order
(possible today by dragging) keeps every visible boundary.

The switch is three steps, not one, because five readers depend on the per-row
column (section 2): add `tier_breaks` and backfill it while `tier` still
exists; move every reader (board-view, `orderBoardForDisplay`,
`computeBoardRanks`, the import response, the editor) to derive from breaks;
then drop `tier` and `tier_count` in a later migration once nothing reads
them. Between step one and step three, `saveBoardPlayers` writes both so
neither representation goes stale.

Screen reader: a break is announced as it passes ("Tier 2 begins"), each row
says its tier in its rank text, and adding or removing a break is announced.

## 8. Saving progress

Two things need a home: the board itself and the run in progress. A run in
progress is more than the board: it is the queue of players still to come, the
player currently climbing, and the undo history. If the reader closes the tab
after question 40, all of that is what lets them pick up at question 41.

Decided: one table for runs, `ranking_builder_runs`, linked to either a board
(signed in) or a guest board (signed out). The run row is deleted when the
run finishes.

The run is an ANSWER LOG, not a state snapshot. A row holds the setup (seed
source, format, scope, depth, start rank, the seed player ids in order) and an
append-only list of answers, each one small and typed: kept, preferred,
skipped, left off, placed at rank N, prompt answered. The state the page shows
(board so far, who is climbing, what the next question is) is a pure fold over
that list by the engine in `lib/ranking-boards/builder.ts`, run on the server
for every write and on the client for display. Undo pops the last answer.
Resume replays. That is why the engine has to be pure and fully tested with no
UI, and it is what the alternative (the client posting a jsonb blob of the
whole state) cannot give:

- The server never trusts client state. Each answer is validated against the
  state the server derived (is that really the pair on screen, is that rank
  really above his current spot, is the guest still under the cap), so the
  guest cap, the depth and the ownership checks all happen in one place.
- The log is bounded. One answer per question, a few dozen bytes each; a 100
  player run with heavy disagreement is a few kilobytes.
- Save volume is bounded. Every answer moves players on the board, and
  `saveBoardPlayers` rewrites every row up to 2,000 on each debounced save.
  The builder does not call it per answer. Answers append to the run row, and
  the board rows are flushed from the derived state on Save and stop, on
  finish, and every 25 answers as a checkpoint, so a crash loses at most a
  few questions and a resumed run rebuilds the rest from the log.

`ranking_builder_runs` RLS: owner-only policies for the signed-in case
(`ranking_builder_runs_{select,insert,update,delete}_own` on `user_id`) plus
`_service_role_all`. Guest runs live in the guest table (below), which has
only the service-role policy.

Guests (decisions 3 and 13). A guest can build and nothing else.

A guest can:

- Run the wizard and the comparisons, up to the guest cap: top 48 for an
  overall, all offense or all defense board, top 12 for one position
  (decision 24).
- See the board so far, undo, skip, leave a player off and place a player at a
  rank, because those are part of building.
- Come back on the same browser within 48 hours and continue.

A guest cannot, and each of these is an invitation to sign in rather than a
hidden control:

- Save the board to an account without signing in.
- Share it, publish it, get a link or an OG card for it, or feature it on a
  profile.
- Add tiers, rename it, or open it in the full editor.
- Go past the guest cap.
- Contribute to the community board.
- Hold more than one guest board at a time.

The guest cap prompt:

- Opens when a guest reaches the cap: the run's last placement at 48 or 12, a
  "Keep going" press, or an attempt to add a player by hand past the cap.
- A designed dialog through `components/slide-up-dialog.tsx` with
  `desktopPlacement="center"`, because it is a decision rather than a detail
  view, the same reason the Signal Scout confirms use it.
- Copy says what they have and what an account adds, concretely: "You've ranked
  your top 48. Sign up or log in to keep this board, rank past 48, add tiers and
  share it." Buttons: Sign up, Log in, and "Not now", which closes it and leaves
  the board as it is.
- The board so far is kept either way and carried into the account on sign-in.
  Nothing a guest built is lost by reaching the cap.
- The cap is enforced on the server as well as in the page, so a guest cannot
  pass it by editing a request.

Storage and lifetime:

- A guest board and its run live server side, keyed by an httpOnly `guest_id`
  cookie (the Would You Rather pattern), so the board survives until the guest
  signs in and the page can state an honest deletion time. There is no public
  URL for a guest board at all; it is only reachable through the cookie.
- The page says, before the first question: "Guest boards are deleted 48 hours
  after your last change. Sign in to keep yours."
- Saving converts the guest board into a normal board for the account, in one
  step after sign-in, and deletes the guest rows. The hand-off has a landing:
  every sign-in and sign-up link from the builder carries
  `next=/tools/custom-rankings?claim=1`, and the tool page, when it sees
  `claim=1` with a signed-in user and a guest cookie, runs the claim action
  and drops the parameter. This is a page step rather than something in the
  auth callback because `app/auth/callback/route.ts` honours `next` for
  OAuth only; password and magic-link confirmations land on "/" by default and
  the login and sign-up forms need to pass `next` through for those paths.
  A guest cookie with no guest board (already claimed, or expired) is a
  no-op, never an error.
- The seed list for a guest. The import route requires a signed-in user
  (section 2), so the builder has its own server loader for the seed list
  (`lib/ranking-boards/seed.ts`), the same query as the import route with the
  same `data_type` filter, callable for guests, and metered through
  `claimRateLimitSlot` per actor key (user id, or salted IP for a guest) so a
  guest cannot pull a thousand-row list in a loop. Signed-in readers pass
  through the same loader; the import route is left as it is.
- An hourly cleanup deletes guest boards and runs older than 48 hours since
  their last change. This iterates guest rows, not leagues, so it is not the
  per-league cron pattern the League Pulse rules forbid. It is a route under
  `app/api/cron/` scheduled in `vercel.json`, wrapped in `verifyCronRequest`
  and `recordCronRun`, and registered in `CRON_JOBS` (`lib/cron-runs.ts`) so
  `cron-health` watches it, the same as the twenty jobs that exist today.
- Guest writes are rate limited per guest and per IP through
  `claimRateLimitSlot`. Guest tables are service-role only: RLS enabled with
  exactly one policy each, `{table}_service_role_all`, in the same migration,
  per the RLS rule that a table ships with its policies. The guest never gets
  an RLS path to them.
- Guest boards never count toward the community board.

## 9. Community rankings

Every saved board feeds a community board, one per format, rebuilt nightly
from the boards built in that format (decision 5 is what makes this possible).

### 9.1 Which boards count

- Every saved board counts unless its owner opts out (decision 19). The opt-out
  is a quiet switch in the board's side panel, "Include in community
  rankings", on by default, with a one-line hint beside it. It never interrupts
  the builder or the editor.
- A board counts only if it ranks enough players (decision 20): at least 50 for
  an overall, all offense or all defense board, at least 12 for a one position
  board. A board below the line is simply not counted, and its side panel says
  how many more players would make it count.
- Guest boards never count.
- One board per account per (format, scope). If an account has several, the
  most recently changed one counts, so one person with ten copies counts once.
- Boards made before the builder have no stored format and cannot count until
  their owner picks one. The side panel asks, once, quietly.
- No individual board is ever identifiable on the community page. Private
  boards contribute to the aggregate only. The privacy policy needs a line
  saying so before this ships.

### 9.2 Merging boards that rank different players

Averaging ranks does not work when boards cover different pools. A quarterback
who is 5th on a quarterback board is not 5th overall, and a board that stops at
50 says nothing about the order of players 51 to 200. So the merge works on
pairs instead of rank numbers.

1. Each board is turned into the head-to-head statements it actually makes:
   - Within the board: every player on it is preferred over every player
     below him on it. These are the only statements a reader actually
     answered, and they carry most of the weight (point 3).
   - Against the pool: every player on the board is preferred over every
     player in the board's POOL who is missing from it. The pool is defined,
     not "every player of the scope": it is the seed source's ranked set for
     the board's format and scope (the `rankings` rows the board was seeded
     from), cut off at the board's depth plus a margin of the same size
     (`poolMargin`, starting at 100 percent, so a 50 player board makes
     statements against seed ranks 51 to 100 and nobody beyond). A 12
     quarterback board says its 12 are better than the 13th through 24th
     quarterbacks; it says nothing about the 40th, and nothing about running
     backs. A board seeded before the builder, with no stored source, uses
     the site default source's set.
   - A player the reader LEFT OFF is recorded on the run as left off, and the
     board makes a within-board style statement about him: everyone on the
     board is preferred over him, at the within-board weight. That is a
     judgement the reader made and it should count as one; a player who was
     simply beyond the depth is only a pool statement. The two are kept
     apart in `user_ranking_board_players` by a `left_off` boolean row (rank
     null), so the merge can tell them apart after the run is gone.
   - Two players who are both missing from a board get no statement from it.
2. All statements from all boards go into one model per format that gives
   every player a single strength score (a Bradley-Terry model, the standard
   method for turning "A beat B" results into a ranking). A player's strength
   is whatever best explains how often he was preferred over whom.
3. Each board carries the same total weight, so a 200 player board does not
   outvote a 12 player one just by producing more pairs. Within that total,
   the within-board statements and the pool statements are weighted
   SEPARATELY (`withinBoardShare`, starting at 0.8). Without the split, a 12
   quarterback board makes 66 within-board pairs and about 12 times 12 pool
   pairs at the pool margin above, and at a wider margin the pairs the reader
   never answered would swamp the ones he did.
4. A mild pull toward the middle (`shrinkage`) keeps a player seen on two
   boards from jumping to the top on a small sample. Every row states how
   many boards ranked him.
5. The fit runs on AGGREGATED counts, not on statements materialised per
   board: the nightly build folds every board into one table of (winner,
   loser, weight) per format, at most a few hundred thousand cells for a
   pool of several hundred players, and fits from that. Materialising 19,900
   pairs per 200 player board across thousands of boards is the other design,
   and it does not scale.
6. Connectivity is checked before publishing. Bradley-Terry only orders
   players who are linked by some chain of comparisons; two groups nobody has
   ever ranked against each other (the offense and defense case below) get
   separate fits and separate views rather than one invented order.

What this gives:

- Position boards and overall boards reinforce each other. Quarterback boards
  settle the order among quarterbacks; overall boards settle where quarterbacks
  sit against running backs.
- One fit per format produces every view: the overall community board, each
  position board (the same order filtered to one position), all offense and all
  defense.
- Where no board ever ranks two groups against each other (defenders against
  offense, if nobody builds an overall board with defenders switched on), the
  page shows those groups separately rather than inventing an order between
  them.

### 9.3 Settings, storage, schedule

- Thresholds live in a global settings row, `ranking_builder_settings`
  (`id text primary key default 'global'`, `settings jsonb`, `updated_by`,
  service-role only, the `manager_pulse_settings` shape from migration 0249),
  admin-editable at `/admin/beacon-ranker`, validated server side by a zod
  schema in `lib/ranking-boards/validate.ts` with defaults in
  `default-settings.ts` and a `settings-coverage.test.ts`, the same layout
  as every other model's settings. It holds both the builder's knobs
  (`winsBeforePrompt`, the guest caps, the default depths, the checkpoint
  interval) and the community merge's: the 50 and 12 board minimums, the
  minimum boards before a player is listed, the minimum eligible boards
  before a format's community board publishes at all, `poolMargin`,
  `withinBoardShare`, `shrinkage`, and the unused `source_enabled`.
- Rebuilt nightly into its own derived table. It iterates formats, not leagues
  or users one by one. No `metadata` column (derived data).
- Where it shows: its own public page at `/rankings/community` (another search
  target: "community fantasy football rankings"), and a second comparison on
  every board ("vs community").
- Starting values (decision 23): a player is listed once he appears on 5
  counted boards, and a format's community board publishes once 25 boards
  count.

### 9.4 Room to become a source later

At launch the community board is its own page and nothing else. It is not in
the Source menu and no other page reads it (decision 21). What is built now so
that adding it later is small:

- The nightly build writes one row per (player, format) in the same shape as
  the `rankings` table: overall rank, positional rank, and the extra columns a
  source does not have (strength score, number of boards). Copying it into
  `rankings` later is then a mapping, not a redesign.
- The settings row carries a `source_enabled` switch, false and unused at
  launch, and the admin panel shows it disabled with the reason.
- Nothing is added to `source_registry` now. A placeholder row would break the
  rule that sources declare only what they actually support.

What enabling it later involves, written down here so nobody has to rediscover
it:

1. A `source_registry` row, slug `community`, display name "Community", with
   `data_type` of rankings only. The board import already filters its sources
   on `data_type`; every other source dropdown must be checked to do the same
   before enabling, so a rankings-only source never appears on a page that
   needs trade values, such as the trade calculator or League Pulse.
2. `supported_format_slugs` set to exactly the formats whose community board is
   published, recomputed by the nightly build as formats cross the threshold,
   and never a format below it.
3. The nightly build also writes its rows into `rankings` under that slug.
4. Historical backfill is not possible: the history starts on the day it is
   switched on, stated in `docs/data-sources/data-sources.md`.
5. The 50-player pairwise audit the source rules require, run on the formats it
   claims.

## 10. Accessibility

- Each choice is one button whose accessible name is a full sentence: "Choose
  Garrett Wilson, WR, New York Jets, finished WR12, WR24, WR15".
- After an answer, a polite live region states the result, including the FF
  Beacon comparison: "Wilson placed 14th, 4 spots higher than FF Beacon. Next:
  Wilson or Chris Olave." Focus stays on the question region.
- Keyboard: Tab between the two buttons, plus the number keys 1 and 2 as
  shortcuts, stated in the instructions. Not Left and Right arrows: a screen
  reader in browse mode uses the arrows itself and the page never sees them,
  and on the stacked mobile layout there is no left or right. The digit
  matches a visible "1" and "2" badge on each card.
- Focus after an answer stays on the question region, but the two buttons
  now name different players, and a button whose name changes under focus is
  not re-announced by every screen reader. The live region's "Next: Wilson or
  Chris Olave" is what tells the reader the question moved on; it is not
  optional.
- The three-win prompt is announced when it appears ("He has won three in a
  row. Place him at a rank, or keep comparing?") and receives focus, since it
  replaces the question the reader was on.
- The board so far is a real ordered list in a disclosure beside the question.
- Reduced motion: the swap animation becomes an instant change.
- Mobile keeps every field shown on desktop; the two cards stack.
- The silent up and down moves in the existing editor are fixed first.

## 11. Search research

Google Ads Keyword Planner, United States, Google search, September 2025 to
August 2026, run 2026-09-25. The account has no active spend, so volume comes
in ranges only. Competition was "Low" wherever it was shown. Large three-month
changes reflect the draft season peak.

The builder's own phrases:

| Keyword | Avg. monthly searches |
| --- | --- |
| custom fantasy football rankings | 100 to 1K |
| custom fantasy football draft board | 100 to 1K |
| fantasy football tier list | 100 to 1K |
| fantasy football rankings spreadsheet | 100 to 1K |
| create your own fantasy football rankings | 10 to 100 |
| make your own fantasy football rankings | 10 to 100 |
| fantasy football rankings maker | 10 to 100 |
| fantasy football rankings builder | 10 to 100 |
| fantasy football rankings generator | 10 to 100 |
| fantasy football rankings tool | 10 to 100 |
| fantasy football rankings template | 10 to 100 |
| fantasy football cheat sheet maker | 10 to 100 |
| custom fantasy football cheat sheet | 10 to 100 |
| fantasy football tier maker | 10 to 100 |
| fantasy football tier list maker | 10 to 100 |
| fantasy football this or that | 10 to 100 |
| my fantasy football rankings | 10 to 100 |
| personal fantasy football rankings | 10 to 100 |
| rank my fantasy football players | 10 to 100 |
| custom dynasty rankings | 10 to 100 |
| custom rankings sleeper | 10 to 100 |
| dynasty rankings builder | no data |
| dynasty rankings tool | no data |
| fantasy football rankings game | no data |
| fantasy football rankings quiz | no data |
| fantasy football would you rather | no data |

The neighbours with real volume:

| Keyword | Avg. monthly searches |
| --- | --- |
| fantasy football rankings | 100K to 1M |
| keep trade cut | 100K to 1M |
| dynasty trade calculator | 100K to 1M |
| dynasty rankings | 10K to 100K |
| rookie rankings dynasty | 10K to 100K |
| ppr rankings | 10K to 100K |
| fantasy football cheat sheet | 10K to 100K |
| fantasy football trade calculator | 10K to 100K |
| fantasy pros rankings | 10K to 100K |
| keeptradecut | 10K to 100K |
| fantasy football player comparison | 1K to 10K |
| fantasy football draft board | 1K to 10K |
| fantasy draft board | 1K to 10K |
| fantasy football tiers | 1K to 10K |
| rank players fantasy football | 1K to 10K |
| who should i draft fantasy football | 1K to 10K |
| superflex rankings | 1K to 10K |
| dynasty superflex rankings | 1K to 10K |
| idp rankings | 1K to 10K |
| fantasy football draft rankings | 1K to 10K |
| fantasy football player rankings | 1K to 10K |
| fantasy football big board | 100 to 1K |
| sleeper rankings | 100 to 1K |

What that says:

- The exact-match builder cluster totals somewhere between a few hundred and
  roughly 2,000 searches a month, concentrated in July and August. Small, nearly
  uncontested, and precisely on target.
- "Rank players fantasy football" (1K to 10K) and "custom fantasy football
  draft board" (100 to 1K) fit the page honestly. "Fantasy football player
  comparison" is a different intent and belongs elsewhere.
- "IDP rankings" (1K to 10K) is new relevance now that boards include
  defenders, and the community board could eventually answer it.
- "Keep trade cut" (100K to 1M): that site's mechanic is readers choosing
  between players, pooled into a crowd value. Beacon Ranker is the personal
  version, and the community board is our pooled one. Copy can describe that
  without naming anyone.
- The bigger payoff is indirect: every finished board has a public URL and an
  OG card, and a faster builder means more finished boards.

## 12. Still open

Nothing is open. Every question raised has an owner decision in section 3.

Choices made in the plan without a separate owner question, listed so they can
be overruled before build:

- Guest boards are deleted 48 hours after their last change, not after
  creation (section 8).
- One guest board per guest at a time (section 8).
- The guest cap of 48 applies to all offense and all defense boards as well as
  overall (section 8).
- If an account has several boards in the same format and scope, the most
  recently changed one is the one that counts toward the community board
  (section 9.1).
- Boards made before the builder count toward the community board only after
  their owner picks a format (section 9.1).
- The comparison with FF Beacon on a half PPR or standard board uses FF
  Beacon's nearest format and names it (section 6).
- A community page below its threshold exists but is `noindex` (section 4.1).

Added in the 2026-09-25 revision, same status:

- The wizard's source and format choice is board-local and never persists to
  the reader's site-wide preference (section 5.1).
- Boards store `format_config_id` and `seed_source_slug`; an overall board
  with defenders is `overall` plus `includes_defenders`, not a new scope
  (section 5.1).
- Depth counts placed players; a guest's wizard defaults to the guest cap
  (section 5.1).
- The three-win threshold is a setting, `winsBeforePrompt` (section 5.2).
- The run is an answer log folded by a pure engine, with board rows flushed
  every 25 answers and on stop (section 8).
- The guest seed list comes from a new metered loader, not the import route
  (section 8).
- The sign-in hand-off lands on `?claim=1` on the tool page (section 8).
- The community merge's pool is the seed set to the board's depth plus
  `poolMargin`, within-board and pool statements are weighted apart, a left
  off player counts as a judgement, and the fit runs on aggregated counts
  (section 9.2).
- Tier breaks land in three steps so no reader of the old column breaks
  mid-sequence; `tier_count` is dropped with `tier` (section 7).
- One "Add tier break after rank" control, not one between every row
  (section 7).
- Number keys 1 and 2 as shortcuts, not the arrows (section 10).
- A companion guide is suggested but NOT in the build order (section 13.9).

## 13. Design

The tool has to look and move like FAAB, League Pulse, Manager Pulse and the
guides, not like a form. Everything below names the component that already
draws the thing, so the build reuses rather than reinvents. Survey of the
component library, 2026-09-25. Colours are the brand tokens in
`tailwind.config.ts` (`brand.purple` #A855F7, `brand.cyan` #22D3EE, the
`position.*` set including `dl`, `lb` and `db`, `signal.*`); the gradient
utility is `bg-beacon`; the site is dark only.

### 13.1 The masthead and the frame

- `PageMasthead` (`components/app-shell/page-masthead.tsx`) inside `PageBody`,
  the same as `app/tools/faab/page.tsx` and `app/tools/league-pulse/page.tsx`.
  Eyebrow "Tools", the H1 from section 4, the lede, and the stat strip on the
  right: boards built, players ranked across them, and, once a format has
  published, boards counted in the community rankings. The chips carry the
  board's format and source once the wizard has run ("Dynasty Superflex",
  "Seeded from FF Beacon"), so the top of the page always says what the
  numbers below mean.
- Below the tool, `ToolExplainer` (`components/tool-explainer.tsx`) with the
  three steps (pick a start, answer, share), notes and an FAQ, which also
  emits `faqPageJsonLd`. This is where the search copy from section 4 lives.
- Route loading is `PulseLoader` through `app/tools/loading.tsx`; the seed
  list loads behind `SectionLoadingCard` (`components/section-loading-card.tsx`)
  so the masthead paints first and the cards arrive under it.

### 13.2 The wizard

- A step rail across the top, the `StepRail` pattern from
  `app/tools/league-pulse/step-rail.tsx` (Start, Players, Depth, Build), with
  `aria-current="step"`. That rail is page-local today; the builder gets its
  own copy rather than promoting it, until a third tool needs one.
- The source and format card is the Sleeper identity card pattern
  (`components/sleeper-handle/identity-card.tsx`): one line saying what the
  run starts from, a Change control, and the pickers in a `Panel`
  (`components/dashboard-panel.tsx`) with `glow` while open.
- The scope choice is a `role="radiogroup"` of large native radios wrapped in
  tile labels, the `components/league-choice-list.tsx` construction, each
  tile carrying a `PositionChip` in its position colour and a one-line
  description from `scopeDescription`. Defenders sit in the same group with
  a "Defense" divider, and the IDP switch beside Overall is a real checkbox
  in a label.
- Depth is a segmented control in the `components/format-toggle.tsx` style
  (24, 48, 100, More) with a number field behind More. A guest sees the cap
  as the last segment and a short line under it saying why.

### 13.3 The comparison screen (the centrepiece)

- Two cards in `grid gap-4 sm:grid-cols-2`, the Would You Rather
  `trade-board.tsx` construction: identical sides, nothing pre-selected, one
  full-width choose button under each. Each card is a `Panel` with the beacon
  hairline along its top edge and a large `PlayerHeadshot` (size 96, square
  corners, as everywhere on the site), name at heading size, `PositionChip`,
  `NflTeamLogo` with the team code beside it, age, and the last three
  positional finishes drawn as three small pills ("2025 WR12", "2024 WR24",
  "2023 WR15") in the position colour, a rookie getting one muted pill. A
  digit badge, 1 or 2, sits in the card's corner and matches the keyboard
  shortcut.
- The whole card is the button. The accessible name is the sentence in
  section 10 and the visible card is its content, so nothing is drawn twice
  and nothing is `aria-hidden` except the logo and the hairline.
- On an answer the chosen card lifts (a 180 ms transform and a purple glow
  from `CARD_GLOW` in `components/tool-badge.tsx`), the loser fades to the
  board rail, and the next pair slides in. These are CSS keyframes in
  `app/globals.css`, each with its own `prefers-reduced-motion` block that
  makes the change instant, the same as every animation the site has. No
  motion library is added; the project has none.
- The result line under the cards is one sentence plus a `TrendChip`
  (`components/trend-chip.tsx`) for the FF Beacon gap: "4 higher" with the
  up glyph and its sr-only text. (`TrendChip` colours its up state with a
  class the config does not define; that is fixed in task 1 so the chip
  reads green here and everywhere else.)
- Progress is the `ProgressBar` from `components/manager-pulse/progress-bar.tsx`
  bound to placed players over depth, with "Player 37 of 100" as its text.
  The fill is bound to counted work and nothing decorative moves it, the
  same rule Manager Pulse keeps.
- The controls row (Undo, Skip, Leave him off, Put him at, Save and stop) is
  a single toolbar under the result line, buttons at 44 px, Undo first
  because it is pressed most.

### 13.4 The board so far

- On `xl` and up it is a rail on the right, the `GuideShell` placement; below
  that it is a disclosure under the cards, the `ChartFigure` details style
  ("View the board so far, 37 players"). Either way it is one real ordered
  list.
- Each row uses the `RankTile` treatment from `components/power-rankings-row.tsx`
  for the rank number, a small headshot, name, `PositionChip`, and the FF
  Beacon `TrendChip`. The player currently climbing is outlined in purple and
  the row he is being compared against in cyan, so the eye can follow the
  question in the list; the live region carries the same information in
  words.
- A tier break is a full-width beacon-gradient hairline with a label pill
  ("Tier 2") on its left, drawn identically in the builder, the editor and the
  public board so a break looks like the same object everywhere.

### 13.5 The three-win prompt and the guest cap prompt

Both are decisions, so both are `SlideUpDialog` with
`desktopPlacement="center"`. The three-win prompt shows the climbing player's
small card, the two choices as two large buttons, and the rank field with the
"Rank 8 is currently Chris Olave" line under it, wired by `aria-describedby`.
The guest cap prompt shows the board so far behind a count ("Your top 48"), a
`StatReadout` row of what an account adds, and the three buttons from
section 8.

### 13.6 The finished run

- A summary `Panel` with `StatReadout` tiles: players ranked, questions
  answered, tiers drawn, and agreement with FF Beacon as a percentage of
  players within three spots.
- "Where you disagree most": a `DivergingBars` chart
  (`components/manager-pulse/charts.tsx`) inside `ChartFigure`
  (`components/chart-kit.tsx`), five players you have higher in purple,
  five you have lower in cyan, the table under the disclosure carrying every
  number. This figure is the OG card's subject too.
- Three CTAs in a row: Draw tiers (the tier pass), Share (the public board
  and its OG card), and "See how everyone else ranks them" (the community
  page, only once that format has published). A guest sees Sign up to keep
  this board in the Share slot.

### 13.7 The editor and the public board

- The editor's tier select per row goes; the break line from 13.4 replaces
  it, and the break's own controls sit on the line.
- Every row gains a "vs FF Beacon" `TrendChip` and, once published, a "vs
  community" one. Two chips, two labels, never one column for both.
- The public board (`components/signal/board-view.tsx`) gets the masthead
  chips (format, scope, agreement percentage), the break lines, the two chips
  per row, and the "Where you disagree most" figure under the list. The board
  OG route is rewritten on `lib/og/assets.ts` (`OG_FONTS`, `OG_WORDMARK`,
  `sleeperPlayerImageUrl`) instead of its hardcoded hexes, and shows the top
  five with tier labels and the agreement figure.
- The tool page and the community page get share cards through the
  `PAGE_CARDS` registry in `app/api/og/page/[key]/route.tsx`, two headline
  lines with the second in gradient, three pills.

### 13.8 The community page

- Masthead with stats: boards counted, players listed, last rebuilt (through
  `formatEastern`). A `format-toggle` style segmented control for format, a
  position toggle in the `war-axis-toggle` style, and the same "N of 25
  boards" `ProgressBar` state when a format is below threshold.
- The list is the `RankingsTable` construction (`components/rankings-table.tsx`)
  with `RankTrendCell` showing movement since the previous rebuild (the derived
  table keeps `previous_rank` for exactly this), "on N boards" as a muted
  column, and a `RankedBars` strip for strength so the gaps between players
  are visible, not only the order.
- Every row links to the player profile, and the profile links back with
  "Community rank: 14th, on 38 boards".

### 13.9 A companion guide (suggested, not in the build order)

The guides are where the site teaches, and "how to build rankings you
actually trust" is a lesson: why head-to-head beats dragging, what a tier
break means, how to read the FF Beacon gap, when to trust the community
board. It would use `GuideShell`, `GuideToc` and `GuideSectionHeader` with
the "Lesson N of M" eyebrow the IDP guide uses, `TryIt` links into the
builder at the end of each lesson, and one embedded widget: a five-question
mini run on a fixed pool, the same comparison card, that ends in "now build
yours". It is left out of the build order below and needs its own approval.

## 14. Build order (once approved)

Each line is one atomic task for progress.md. The standard reviews
(implementation, accessibility, security) run after each.

1. Fix the silent up and down moves in the existing editor, and the undefined
   up colour class in `components/trend-chip.tsx`.
2. Migration: `scope` widened to DL, LB, DB and `defense`; `includes_defenders`,
   `format_config_id`, `seed_source_slug` and the community opt-out on
   boards; `left_off` on board players. Policies unchanged.
3. The existing import dialog writes `format_config_id` and `seed_source_slug`.
4. Remove the search pool guard so the editor uses `ranked+idp`, and the new
   scopes in `lib/ranking-boards.ts` labels and the profile board list.
5. Migration: add `tier_breaks` and backfill it from the per-row tiers, keeping
   `tier` and `tier_count`.
6. Every reader derives tiers from breaks; `saveBoardPlayers` writes both.
7. Editor tier-break controls (add after rank, per-row add below, move one,
   move to rank, drag, remove), replacing the per-row tier select.
8. Migration: drop `tier` and `tier_count`.
9. Settings row `ranking_builder_settings` (migration with RLS), defaults,
   validation, coverage test, and the admin panel at `/admin/beacon-ranker`,
   with `source_enabled` shown disabled.
10. Pure comparison engine (`lib/ranking-boards/builder.ts`): the answer log
    fold, next question, answer, undo, skip, leave off, the three-win prompt,
    place at rank, start-from-rank. Fully unit tested, no UI.
11. Migration: `ranking_builder_runs`, with RLS in the same file.
12. Migration: guest boards and guest runs, service-role only.
13. Guest cleanup cron (48 hours after last change), registered in
    `CRON_JOBS` and `vercel.json`.
14. Seed list loader (`lib/ranking-boards/seed.ts`), metered, usable by guests.
15. Defender seed loader: projected points first, last season second.
16. Card data loader: finishes, team, age.
17. FF Beacon comparison loader, with the format fallback.
18. Answer server action: validates each answer against the derived state,
    appends to the log, flushes board rows on the checkpoint rule.
19. Wizard component: step rail, source and format card, scope tiles, depth.
20. Comparison screen: cards, animation with reduced-motion, live region,
    number-key shortcuts, progress bar, controls toolbar.
21. Board-so-far rail and disclosure, with the break line component shared
    with the editor.
22. Three-win prompt dialog.
23. Finished-run summary with the "Where you disagree most" figure.
24. Tier pass at the end of a run.
25. Editor integration ("Build by comparing"), the builder mounted as its own
    component tree.
26. Public tool page at `/tools/custom-rankings`: `TOOLS_NAV`,
    `SEARCHABLE_TOOLS`, `TOOL_CATALOG`, the site-layout default order (two
    tests enforce agreement), metadata, `ToolExplainer`, `PAGE_CARDS` share
    card, llms.txt.
27. Guest caps (48 and 12), enforced in the answer action.
28. Guest cap prompt (centred slide-up dialog), the `next=` pass-through on
    the login and sign-up forms, and the `?claim=1` hand-off.
29. "vs FF Beacon" on the editor, the public board page and the rewritten
    board OG route.
30. Internal links into the builder: `/rankings`, public board pages, player
    profiles, My Beacon, home page card, guides.
31. Community pair builder and strength model (`lib/community-rankings/`),
    pure and unit tested against boards with different pools, lengths and
    left-off players, including the connectivity check.
32. Community board table, shaped to map onto `rankings` with
    `previous_rank`, and its nightly build on aggregated counts.
33. Board side panel: community opt-out, eligibility count, format prompt for
    older boards.
34. Privacy policy line on community rankings.
35. Community page at `/rankings/community`, with the below-threshold state,
    `noindex`, and its share card.
36. Internal links into the community page and the "vs community" comparison,
    shown only for formats that have published.
37. CLAUDE.md section for Beacon Ranker, including the "vs FF Beacon"
    exception to the source sync rule.
