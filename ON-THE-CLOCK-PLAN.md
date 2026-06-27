# On The Clock - Implementation Plan (PLAN ONLY, not implemented)

Status: Draft for review, revised per owner decisions (rev 2). Nothing has been
built. No production code, migrations, commits, or pushes. Value pipelines untouched.

Feature: a Sleeper-connected live draft helper for startup and rookie drafts.
Tagline fit: "Your signal through the fantasy noise." On The Clock is the in-draft
signal: it strips drafted players out of the pool and surfaces the best remaining
FF Beacon value for the league's format, by eye or by ear.

Rev 2 headline changes (owner decisions folded in):
- Supabase is now the shared memory for On The Clock. Active draft state (metadata
  + picks) is cached in Supabase, synced through a server route guarded by a durable
  30-second per-draft lock (a SECURITY DEFINER RPC), so multiple viewers of the same
  draft never all hammer Sleeper.
- Automatic polling is replaced by a manual "Sync Draft" button plus Supabase
  Realtime: when one viewer syncs and new pick rows land, every other viewer of that
  draft updates from Supabase without touching Sleeper.
- Team Need is re-specified around normalized value (VORP) and a slot-fill roster
  model, not raw value counts.
- Dynamic NFL season (no copied hardcoded 2025), with a graceful empty state when the
  rankings table has no rows for the season.
- DST and kickers live in the draft room everywhere, but are suppressed from
  recommendations until a late-round roster-need condition applies.
- Available list is a paginated semantic table (no virtualization for MVP); the board
  is a native table with stable draft-slot columns.

---

## 1. Executive summary

### What we are building
A public tool at `/tools/on-the-clock` that:
1. Resolves a Sleeper username (saved when signed in, or typed manually) using the
   League Pulse anonymous flow.
2. Lists only the user's leagues that have an active draft for the current season.
3. Uses the selected league as the single gateway to its active draft.
4. Detects the closest FF Beacon format from the league/draft settings (user can
   override). Source is user-selectable; if the source does not support the format,
   the existing FF Beacon fallback runs and the UI explains the swap.
5. Caches the draft metadata and picks in Supabase, shared across all viewers of that
   draft, and removes drafted players from the pool.
6. Ranks the remaining players by existing FF Beacon value for that format/source.
7. Surfaces two deterministic recommendation cards (Best Available, Team Need), a
   draft board, a chronological pick list, an available list, and a "My Draft" view.
8. Updates the room two ways: a manual Sync Draft button (server-enforced 30s
   cooldown) that pulls new picks from Sleeper into Supabase, and Supabase Realtime
   that pushes Supabase pick changes to every viewer with no Sleeper call.

### Why it fits FF Beacon
- Consume-only for values: it reads the same `rankings` / `player_value_history` /
  `player_value_trends` rows the Rankings Board reads. It changes nothing about how
  values are calculated.
- It reuses the League Pulse username flow, the Signal Check design language and
  plain-English posture, the FAAB admin-settings pattern, and the existing
  `try_claim_*` durable-lock pattern (migrations 0026/0028) for the sync cooldown.
- Accessible-first: the available list and pick list are full peers of the visual
  board, and Realtime updates announce through a controlled live region.

### MVP scope vs later scope
MVP (this plan):
- Anonymous + saved-username entry, active-draft league filtering, format detection +
  override, user-selectable source with fallback.
- Supabase shared draft cache (metadata + picks) with a durable 30s sync lock RPC.
- Manual Sync Draft button + Supabase Realtime fan-out to co-viewers.
- Everyone / Rookies-only pools (rookie draft defaults to Rookies-only).
- DST/K present everywhere in the room, suppressed from recommendations except late
  roster-need.
- Best Available + Team Need cards (deterministic, VORP-normalized, admin-tunable).
- Board, pick list, available list (paginated table), My Draft, full state set.
- Admin settings page mirroring FAAB.

Explicitly later:
- Permanent per-user draft history and public share pages (NOT in MVP; the cache is
  shared infrastructure, not private history).
- Auction nomination/budget helper (auction renders read-only).
- ADP-vs-value deltas, positional-run alerts, multi-source blending.
- Optional auto-sync interval toggle (default off; Realtime covers co-viewer updates).
- Broadcast-based Realtime if a single draft ever has hundreds of concurrent viewers.

---

## 2. Codebase audit findings

All paths relative to repo root. Line numbers from the audit pass.

### Reusable as-is (no change)
- `lib/sleeper.ts` - `safeFetch` (20s timeout, null/[] on failure, `no-store`),
  `getSleeperUser(username)` (:100), `getSleeperLeagues(userId, season)` (:104),
  `getSleeperLeague(id)` (:111), `getSleeperRosters(id)` (:115),
  `getSleeperLeagueUsers(id)` (:119), `getSleeperLeagueDrafts(leagueId)` (:156),
  `getSleeperDraft(draftId)` (:160), `getNflState()` (:181), `currentNflSeason()`
  (:218). `SleeperDraft` type (:87-98) carries `slot_to_roster_id`, `status`, `type`,
  `settings`, `start_time`.
- `lib/sleeper-to-format.ts` - `deriveLeagueFormat` (:10), `mapToFormatSlug` (:55),
  `deriveFormatSlug` (:77), `describeDerivedFormat` (:82), `pickClosestSupportedFormat`
  (:114). Tests exist.
- `lib/preferences.ts` / `lib/source.ts` / `lib/format-fallback.ts` - source/format
  resolution: `resolveSourceSlug`, `resolveFormatSlug`, `getAvailableSources`,
  `getActiveFormats`, `sourceSupportsFormat`, `resolveSourceForFormat`,
  `reconcileFormatWithSource`, `pickFallbackFormat`.
- `components/player-headshot.tsx` - `PlayerHeadshot({ sleeperId, position, name,
  size })`. `next.config.ts` whitelists sleepercdn.
- `lib/ranking-boards.ts` - `readSleeperId(externalIds)` (:83).
- `components/format-toggle.tsx`, `components/source-toggle.tsx`,
  `components/trend-chip.tsx`, `components/beacon-value-icon.tsx`.
- `lib/datetime.ts` - `formatEastern`, `SITE_TIME_ZONE`.
- `lib/sleeper-league-settings.ts` - `parseSleeperLeagueSettings`,
  `mergeSleeperLeagueSettings`.
- Admin spine: `lib/admin-auth.ts` `requireAdmin` (:47), `components/admin-nav.tsx`
  `NAV_ITEMS` (:27). FAAB settings stack is the template (section 3).
- Durable lock pattern: `try_claim_league_refresh` (migrations 0026/0028) is the
  proven SECURITY DEFINER claim-and-cooldown shape we copy for the sync lock.

### Reuse the pattern, write a tool-local copy
- Rankings query shape (`app/rankings/page.tsx:114-228`): join `rankings` + `players`
  for rank/tier/position_rank, dedupe latest `player_value_history.value`, attach
  `player_value_trends` movement. Copy into a tool-scoped board loader keyed by the
  resolved (format, source), with the season parameterized (NOT the hardcoded
  `SEASON = 2025` at `app/rankings/page.tsx:27`). Note the rankings page resolves
  source SEPARATELY per table (page.tsx:92-103); the loader must replicate that.
- Reverse Sleeper-id lookup (`import-actions.ts mapSleeperPlayers` :228): chunk-by-200
  `external_ids->>sleeper` filter. We extract a shared, partial-tolerant helper that
  also handles non-numeric DST ids (the existing filter is numeric-only, :233).
- Username entry (`app/tools/league-pulse/league-pulse-form.tsx`) and saved-username
  save form (`sleeper-import-panel.tsx UsernameSaveForm` :509).
- FAAB admin: `app/admin/faab/{page.tsx, actions.ts, faab-settings-manager.tsx}`,
  `lib/faab/{types.ts, default-settings.ts, settings.ts}`, migration
  `0105_faab_calculator_settings.sql` (single-row JSONB, service-role-only RLS).

### Must be newly written
- `getSleeperDraftPicks(draftId)` in `lib/sleeper.ts` (`GET /draft/{id}/picks`) - the
  one genuinely new Sleeper fetcher (only draft metadata is consumed today).
- The Supabase cache tables + sync-lock RPCs (section 9).
- `lib/players/sleeper-map.ts` partial-tolerant reverse lookup incl. DST/K ids.

### Risks from current architecture (carried)
- R1. `buildValueResolver` hardcodes `FFBEACON_SOURCE_SLUG`; we build a tool-local,
  source-parameterized loader instead.
- R2. No boolean rookie flag on `players`; derive from `draft_year`/`years_experience`.
- R3. League deep view dir is `app/leagues/[league_id]`; we add no league route.
- R4. `format_configs` has up to 12 active rows; gate on `is_active` via
  `getActiveFormats`, never hardcode.
- R5. Sleeper returns `"0"` placeholders, non-numeric DST ids ("BUF"), and loosely
  typed pick `metadata`; normalize defensively.
- R6 (new). Migration numbers collide in the repo (duplicate 0028/0029, 0100-0103).
  Use the real next free number after a collision check, not a placeholder.

---

## 3. Recommended route structure

### Public tool
```
app/tools/on-the-clock/
  page.tsx                      Server: auth + saved username + settings + season
                                check; renders the shell. force-dynamic.
  on-the-clock-client.tsx       Client root: draft state, Realtime subscription,
                                Sync button, view tabs. No Sleeper calls here.
  username-gate.tsx             Clone of league-pulse-form (anon + saved entry).
  league-picker.tsx             Active-draft league list + empty state + refresh.
  command-header.tsx            Draft Command Header + sync status line.
  sync-button.tsx               Sync Draft button + cooldown copy.
  recommendation-cards.tsx      Best Available + Team Need cards.
  available-list.tsx            Paginated semantic table (search/filter/Show more).
  draft-board.tsx               Native table, stable draft-slot columns.
  pick-list.tsx                 Chronological picks (list-first a11y peer).
  my-draft.tsx                  Connected user's picks + roster shape.
  states.tsx                    Shared empty/loading/error blocks.
```

### API routes
```
app/api/on-the-clock/leagues/route.ts        GET ?username=&season=
    Resolve user -> leagues -> active-draft filter (section 6). Durable abuse guard
    (RPC, section 12) + header guard + input validation. Returns trimmed league cards.

app/api/on-the-clock/draft/route.ts          GET ?draft_id=
    READ-ONLY. Returns the SHAPED draft + picks straight from the Supabase cache.
    No Sleeper call. This is what loads on navigation and what Realtime supplements.
    If the cache is cold (no row), it transparently performs one sync (same path as
    POST) to warm it, respecting the lock.

app/api/on-the-clock/draft/sync/route.ts     POST { draft_id }
    STATE-CHANGING. Claims the durable 30s lock via RPC; if claimed, fetches latest
    picks from Sleeper and upserts into the cache, then completes the lock; if not
    claimed (synced within cooldown or another sync in flight), returns the cached
    data plus a status ("served-cache" | "cooldown" | "synced-by-other"). Always
    returns the current shaped cache so the client can render regardless.
```
Why a POST for sync and GET for read: the sync mutates shared state and must be
uncacheable and rate-limited by the durable lock; the read is a thin, shapeable cache
fetch. Server actions are an option but a POST route keeps the lock seam and status
contract explicit and testable.

### Admin
```
app/admin/on-the-clock/
  page.tsx                      requireAdmin -> loadOnTheClockSettings -> manager.
  actions.ts                    saveOnTheClockSettings (requireAdmin, validate,
                                service-role upsert, revalidatePath admin + tool).
  on-the-clock-settings-manager.tsx   "use client" form (clone of FAAB manager).
lib/on-the-clock/
  types.ts                      Settings + computed types.
  default-settings.ts           DEFAULT_ON_THE_CLOCK_SETTINGS.
  settings.ts                   zod schema (+ .default per field) + loader.
  format.ts                     Draft-context -> resolved format/source.
  player-pool.ts                Pool build + rookie derivation + DST/K handling.
  recommend.ts                  Best Available + Team Need (VORP + slot-fill, pure).
  draft-shape.ts                Snake/linear/3RR slot math + board assembly.
  cache.ts                      Read/shape cache rows; call the sync RPCs.
  sleeper-sync.ts               Server-only: claim lock -> fetch Sleeper -> upsert
                                picks -> complete/release lock.
```
Add a nav tab in `components/admin-nav.tsx` `NAV_ITEMS` (`/admin/on-the-clock`, a
`Timer`/`Clock` icon).

### Shared utility
- `lib/players/sleeper-map.ts` - partial-tolerant reverse lookup, numeric + DST ids.
- Register the tool in `lib/site.ts` (`TOOLS_NAV`, `FOOTER_COLUMNS`) and
  `app/tools/page.tsx` (`TOOLS` array + the `href` union type).

---

## 4. Data flow

### Discovery (per user, hits Sleeper, abuse-guarded)
```
username (typed or saved)
   -> getSleeperUser(username)            => user_id
   -> getSleeperLeagues(user_id, season)  => leagues[]   (season = currentNflSeason())
   -> active-draft filter (section 6)     => selectable leagues
   -> user selects a league_id
   -> getSleeperLeagueDrafts(league_id)   => choose the active draft => draft_id
```

### Sync (server-only, through the durable lock, the ONLY Sleeper-write path)
```
POST /draft/sync { draft_id }
   -> rpc claim_on_the_clock_sync(draft_id, cooldown_seconds)
        claimed=false -> return cached shape + status (cooldown | synced-by-other)
        claimed=true  -> continue:
             getSleeperDraft(draft_id)        => metadata, slot_to_roster_id, type
             getSleeperDraftPicks(draft_id)   => full picks[] (NEW fetcher)
             getSleeperLeagueUsers(league_id) => display names (stored in cache row)
             getSleeperRosters(league_id)     => roster_id->owner + roster players
             upsert on_the_clock_draft_cache (metadata, users, rosters, status)
             upsert on_the_clock_pick_cache (one row per pick, unique by pick_no)
             rpc complete_on_the_clock_sync(draft_id, pick_count, status)
   (on Sleeper failure: rpc release_on_the_clock_sync(draft_id) clears the in-progress
    lock WITHOUT advancing last_synced_at, so the user can retry sooner)
```

### Read + live update (no Sleeper)
```
GET /draft?draft_id   -> read on_the_clock_draft_cache + on_the_clock_pick_cache
                         -> shape to the client payload (board, picks, available)
client subscribes to Supabase Realtime on on_the_clock_pick_cache
   filter sleeper_draft_id=eq.{draft_id}
   -> on INSERT/UPDATE, merge the new pick into local state, recompute available +
      recommendations from already-loaded data (NO Sleeper, NO extra DB round-trip)
```

### Value side (reads only, season-checked)
```
season = currentNflSeason()  (verify rankings has rows for the resolved format/source)
resolved (format_config_id, source-per-table) ->
   rankings (rank, tier, position_rank, player join)
   + player_value_history (latest value)   [source resolved for this table]
   + player_value_trends (7d movement)
   => RankedPlayer[]  (full draftable board incl. DST/K when ranked)

pick.sleeper_player_id -> player_id (resolved at sync time, stored on the pick row)
available = RankedPlayer[] minus drafted player_id minus unmapped-by-name guard
```
Player-id resolution happens once, server-side, at sync time, and is stored on the
pick row (`player_id`). Realtime and the read path never re-run the DB mapping per
viewer.

### My picks detection
```
connected user_id -> cached rosters: roster where owner_id == user_id OR
   co_owners includes user_id  => my roster_id(s)
picks where picked_by == user_id (primary)
   fallback roster_id in mine, then slot_to_roster_id + draft_slot
```

### Player-id mapping (sync time, partial-tolerant, DST/K-aware)
- `mapSleeperToPlayerIds(client, sleeperIds): Map<string,string>` in
  `lib/players/sleeper-map.ts`. Accepts a generic `SupabaseClient<Database>` (anon
  works for the public `players` table). Chunk by 200. IDs are validated/sanitized to
  `^[A-Za-z0-9]{1,16}$` so numeric player ids AND team-style DST ids ("BUF") both pass;
  build the filter with `.in()` on the sanitized array (or a sanitized `.or()`),
  never raw concatenation.
- DST/K specifically: Sleeper DST ids are team codes; we map them to the FF Beacon
  DST player rows via `external_ids->>sleeper` the same way (our ingestion stores the
  team code there). Kickers are normal numeric ids. Both must round-trip; see fixtures
  in section 14.
- Unmapped drafted players: still removed from the pool (name guard), rendered on the
  board/pick list from the cached pick `metadata` (first_name/last_name/position/team),
  no value chip. Count surfaced as "{n} picks not in our database".

---

## 5. Format detection plan

### Mapping Sleeper -> FF Beacon (owner decision 1)
- Format is draft/league-derived by default, user-overridable. Source is
  user-selectable (normal tool behavior), not derived.
- Reuse `lib/sleeper-to-format.ts`: `deriveLeagueFormat(league)` then
  `deriveFormatSlug(league)` for the default format. Detection runs against the rich
  `getSleeperLeagues` entry (which carries `scoring_settings`, `roster_positions`,
  `previous_league_id`); the thin `SleeperDraft` object alone cannot infer SF/TEP, so
  the league entry is the primary input and the draft object is only a backstop for
  `teams`/`rounds`/`type`.
- Rookie-draft hint sets the DEFAULT pool to Rookies-only (owner decision 6):
  `draft.type === "rookie"`, a rookie-ish `metadata.name`, or rounds <= roster rookie
  capacity. Never forces it; the user can switch to Everyone.

### Source + fallback (owner decision 1)
- Source dropdown shows all active sources (standard tool behavior). If the chosen
  source does not support the derived/selected format, run the existing fallback:
  `reconcileFormatWithSource` / `pickFallbackFormat`, and explain it in the UI with
  the standard pre-click "(changes format)" warning + aria-label + `role="tooltip"`,
  plus a post-swap banner naming the fallback format.
- Format dropdown is filtered to formats the chosen source supports (asymmetric gating
  per CLAUDE.md).
- Override is transient (URL `?format=`/`?source=`), not persisted to cookie/DB from
  this tool.

### Fallback / failure
- `deriveFormatSlug` returns null: fall back to the admin "Default format fallback",
  quiet banner ("We could not match this league's exact scoring, so we are showing
  {format}. You can change it above."), user override available.
- Resolved (format, source) has zero ranked rows OR the season has no rankings
  (section 9 season check): render the Sleeper board/picks (still watchable) but show
  the "values unavailable for this format/season" state on the value-dependent panels.

---

## 6. League selection plan

### Detecting active leagues without hammering Sleeper
1. `getSleeperLeagues(user_id, season)` once, `season = currentNflSeason()`.
2. Cheap pre-filter on each league object: `league.status === "drafting"` and/or
   `league.settings.draft_id` presence.
3. For ambiguous leagues (`pre_draft`, recent `in_season`), confirm with
   `getSleeperLeagueDrafts(league_id)` only for that subset, hard-capped by admin
   "Max active leagues returned" and run with bounded, jittered concurrency. Active =
   `draft.status in {"drafting","paused"}`. `pre_draft` is shown as "not started".
4. `complete` drafts excluded from MVP.

If an active draft exists beyond the cap, the picker notes "Showing the first N; refine
by refreshing if your draft is missing" (no silent truncation).

### Abuse guard (durable, owner decision 3)
The leagues route is the fan-out surface. Guard it with a durable Supabase claim RPC
(`try_claim_on_the_clock_lookup`, keyed by IP + normalized username, short window),
not in-memory, so a rotated-username attack cannot fan out unbounded Sleeper calls
across instances. Header guard + input validation also apply (section 12).

### Empty state copy
> "Only leagues that are actively drafting will show up here. If you do not see a
> league, the draft may not have started yet or may already be finished. Try Refresh
> once your draft opens."

### Manual refresh
Refresh re-requests the leagues route (respecting the durable lookup guard) and
announces "Refreshed. {n} active draft leagues." via `aria-live`.

---

## 7. Recommendation logic plan (re-specified, owner decision 11)

Two cards, side by side, clearly labeled: Best Available = pure value; Team Need =
roster-context aware. Deterministic, no AI, admin-tunable, explainable.

### Normalization (the foundation)
All comparison happens on normalized scales so default weights are portable across the
up-to-12 formats and the two sources, never raw value magnitudes.

- `valueScore(p)` = the player's FF Beacon value rescaled to 0-100 across the current
  available board: `100 * (value - minAvail) / max(1, topAvail - minAvail)`.
- `vor(p)` = Value Over Replacement = `max(0, value(p) - replacement[pos])`, where
  `replacement[pos]` = the value at positional rank `R_pos`, and `R_pos = teams *
  startableSlots[pos]` (league-wide startable depth, FLEX/SF folded in below). VORP is
  comparable across positions and already encodes scarcity. `vorScore(p)` = VORP
  rescaled 0-100 across the available board.

### Slot-fill roster model (replaces position counts)
Compute open starting slots after assigning the user's current players to slots:
1. Seed `have` from the user's roster. For dynasty drafts, seed from the cached Sleeper
   roster players (`on_the_clock_draft_cache.rosters`) PLUS in-draft picks. For redraft
   startups, `have` = in-draft picks only. If roster seeding is unavailable or
   unreliable, degrade to rookie-pool scarcity/value and say so in copy.
2. Assign players to dedicated slots first (QB, RB, WR, TE), then spill into FLEX
   (RB/WR/TE), then SUPER_FLEX (QB/RB/WR/TE), by eligibility. A drafted QB therefore
   correctly reduces SUPER_FLEX need; FLEX multi-position eligibility is handled.
3. `needScore(p)` reflects whether p fills a still-open slot it is eligible for,
   weighted by that slot's scarcity (a tier-cliff multiplier from `rankings.tier` /
   positional value drop), rescaled 0-100. Superflex raises QB need naturally (open SF
   slot) and via an admin SF QB priority multiplier; TE premium raises TE need via an
   admin TEP TE multiplier when `te_premium_bonus > 0`.

### Reach (positional, never global)
`reachScore(p)` = how far p sits below the best AVAILABLE player AT THE SAME POSITION
(or below `replacement[pos]`), rescaled 0-100, and gated by a tier break (only nonzero
once p is more than one tier below the best realistic same-position option). This makes
filling a need never penalized for sitting below an unrelated global top. This is the
fix for the rev-1 bug where a top WR vetoed a needed QB.

### One canonical equation
```
blended(p) = wValue * valueScore(p)
           + wNeed  * needScore(p)
           - wReach * reachScore(p)
```
- All three components are 0-100. Weights are unitless.
- Aggressiveness preset sets `wNeed` (Conservative 0.25 / Balanced 0.40 / Aggressive
  0.55), `wValue = 1 - wNeed`, `wReach` a small admin constant (default 0.15).
- Best Available = the available player (respecting the active position filter) with
  the highest raw value. Team Need = the available player with the highest `blended`.

### Deterministic tie-breaks
Equal `blended` -> higher raw value -> better `position_rank` -> lowest `players.id`.
Required for reproducible tests.

### Component breakdown (UI reason matches the math)
`recommend.ts` returns, per recommended player:
```
{ valueComponent, needComponent, reachComponent, decidingFactor, filledSlot }
```
`decidingFactor` names which term dominated; the plain-English reason is generated from
it, never asserted independently. `filledSlot` names the slot the need pick fills.

### DST/K policy (owner decision 7)
- DST and kickers appear everywhere in the room: board, pick list, available list (when
  ranked/mapped), My Draft, and removed-from-available when drafted.
- Best Available naturally almost never returns DST/K (low value); no special exclusion
  needed unless the user position-filters to DST/K, in which case it shows the best one.
- Team Need suppresses DST/K UNLESS all of: admin "allow DST/K recommendation" is on,
  the league starting lineup requires that slot, the user lacks one, and the draft is
  past the admin "minimum round/pick before DST" (or K) threshold. Then the best DST/K
  becomes the legitimate late-round need pick. Defaults are conservative: included in
  room, suppressed from recommendation until late roster-need applies.
- This DST/K gate is wired into the scoring contract in `recommend.ts`, not just UI copy.

### Best Available == Team Need (owner decision 8)
If the top value player is also the top blended player, BOTH cards point at that same
player, labeled "Value and need align." Do NOT demote the user to a worse runner-up. A
secondary need pick may be shown below as supplementary, but the primary card stays on
the best player.

### Edge cases where Team Need degrades (not suppressed to a bad pick)
- No detected picks and no roster seed (first overall / team undetected): Team Need
  shows "We will tailor this once we can detect your team or you have made a pick" and
  falls back to scarcity-aware value.
- All starting slots filled (deep draft): collapses to "Best value for depth/upside".
- Rookies-only pool with noisy roster math: runs on scarcity/value and says so.

### Plain-English examples
- "Your roster is light at RB compared to this league's starting lineup, and this is
  the best-value RB still available."
- "Superflex league and you have one QB. This QB is the best value that fills that gap
  without reaching far below the board."
- "It is late and your lineup needs a defense. This is the best DEF still available."

---

## 8. UI/UX plan

### Desktop layout
- Sticky Draft Command Header: tool name, league name, draft name, status chip, format
  chip, source chip, pool toggle, teams/rounds/total picks, last pick, user's team/slot
  when detected, and a sync status line (section below).
- Two columns: left = recommendation cards over the available list; right = tabbed
  panel (Board / Picks / My Draft).

### Sync status + button (owner decisions 4, 5)
- A "Sync Draft" button with a live status line driven by `last_synced_at` and the
  cooldown:
  - "Last synced 18 seconds ago"
  - "Next sync available in 12 seconds" (button disabled during cooldown)
  - "Synced by another viewer 5 seconds ago" (when the lock was held by someone else)
  - "Updated just now" (after Realtime delivers co-viewer picks)
- The button respects the shared server-side cooldown; a click within the window
  returns cached data and the "synced recently" message rather than hitting Sleeper.
- Realtime keeps the room current between syncs with no button press.

### Mobile layout
- Command header collapses to a summary that ALWAYS shows draft status, the
  on-the-clock state, and last pick (never behind a disclosure); secondary counts go
  behind an `aria-expanded` disclosure. No data hidden at any breakpoint; 44x44 targets.
- View switcher implemented as an APG tabs pattern (`role="tablist"`), not ambiguous
  "segmented control" divs: Recommend / Available / Board / Picks / Mine.

### Available list (owner decision 10)
- A real semantic `<table>` with search, position/pool filters, and pagination /
  "Show more" (admin "Max available players shown before Show more", default ~100). NOT
  virtualized for MVP. Screen-reader usability over infinite scroll.
- Sort controls are `<button>`s inside `<th>`; the active column carries `aria-sort`.

### Draft board (native table, owner decision 10)
- Native `<table>`: columns = draft seats (`<th scope="col">`, STABLE across rounds),
  rows = rounds (`<th scope="row">`). Snake/3RR reversal is visual only (CSS order);
  the true serpentine pick number lives in each cell's text + `aria-label` ("Round 2,
  Pick 2.12 overall, J. Chase, WR, Team Smith"). Not virtualized (180 cells are fine).
- The user's own picks carry a text "Your pick" marker, not color alone. Current/last
  pick carry "On the clock" / "Last pick" text. Empty/keeper/unmapped cells carry text
  ("Open slot", "Keeper").

### Recommendation cards
- `PlayerHeadshot`, name, team, position, FF Beacon value, tier, positional rank, and a
  reason generated from `decidingFactor`. Labels: "Best Available - pure value" and
  "Team Need - fits your roster". Position filter chips re-scope both. When they align,
  one shared card labeled "Value and need align".

### States
- Branded skeletons (cyan `Loader2` in a `role="status"` card; `PulseLoader` full-page).
- Errors use the existing `role="alert"` danger card.

### Plain-English copy
- "Only leagues that are actively drafting will show up here."
- "We matched this league to {format}. Not right? Change it above."
- "Everyone shows all ranked players still available. Rookies only narrows it to this
  year's incoming class."
- "We could not find rankings for the {season} season yet. The draft board still works;
  values will appear once this season's rankings are published."

---

## 9. Data/storage plan (Supabase shared cache, owner decisions 2 and 3)

Supabase is the shared memory for active drafts. The goal is shared cache, not private
user history: no per-user draft archive, no share pages in MVP.

### Tables

`on_the_clock_settings` (single-row admin config, FAAB pattern)
```
id text primary key default 'global' check (id = 'global'),
settings jsonb not null,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now(),
updated_by uuid references auth.users(id)   -- server-set from requireAdmin, never client
```

`on_the_clock_draft_cache` (one row per Sleeper draft, the shared record + lock)
```
sleeper_draft_id   text primary key,
sleeper_league_id  text not null,
season             text not null,
draft_status       text,                 -- pre_draft | drafting | paused | complete
draft_type         text,                 -- snake | linear | auction
pick_count         int  not null default 0,
metadata           jsonb not null default '{}'::jsonb,  -- full Sleeper draft object
league_users       jsonb,                -- display names, small
rosters            jsonb,                -- roster_id -> owner + roster players[]
last_synced_at     timestamptz,          -- advances only on a SUCCESSFUL sync
sync_locked_until  timestamptz,          -- short in-progress lock to block concurrency
created_at         timestamptz not null default now(),
updated_at         timestamptz not null default now()
```
Indexes: pk (`sleeper_draft_id`); btree (`sleeper_league_id`); btree (`season`); btree
(`last_synced_at`) for cleanup; btree (`updated_at`).

`on_the_clock_pick_cache` (one row per pick; Realtime source)
```
sleeper_draft_id   text not null references on_the_clock_draft_cache(sleeper_draft_id)
                        on delete cascade,
pick_no            int  not null,
round              int,
draft_slot         int,
roster_id          int,
picked_by          text,                 -- Sleeper user id (public draft data)
sleeper_player_id  text,
player_id          uuid references players(id),   -- resolved at sync, null if unmapped
is_keeper          boolean not null default false,
metadata           jsonb,                -- raw pick (first/last/position/team/amount)
created_at         timestamptz not null default now(),
updated_at         timestamptz not null default now(),
primary key (sleeper_draft_id, pick_no)
```
Indexes: pk (`sleeper_draft_id`, `pick_no`); btree (`sleeper_draft_id`) for the
Realtime filter + read; the cascade FK covers cleanup.

### Sync-lock RPCs (SECURITY DEFINER, the durable server-enforced lock)
Modeled on `try_claim_league_refresh` (migrations 0026/0028).

`claim_on_the_clock_sync(p_draft_id text, p_league_id text, p_season text, p_cooldown_seconds int) returns record`
```
1. insert into on_the_clock_draft_cache (sleeper_draft_id, sleeper_league_id, season)
   values (...) on conflict (sleeper_draft_id) do nothing;     -- ensure row exists
2. update on_the_clock_draft_cache
     set sync_locked_until = now() + interval '15 seconds', updated_at = now()
   where sleeper_draft_id = p_draft_id
     and (last_synced_at is null or last_synced_at < now()
           - make_interval(secs => p_cooldown_seconds))
     and (sync_locked_until is null or sync_locked_until < now())
   returning true into claimed;
3. return (claimed,
           last_synced_at,
           greatest(0, p_cooldown_seconds - extract(epoch from now()-last_synced_at)),
           (sync_locked_until > now()) as locked_by_other);
```
- `claimed=true` -> caller fetches Sleeper and upserts picks, then calls
  `complete_on_the_clock_sync`.
- `claimed=false` -> caller serves cache with status `cooldown` (recent success) or
  `synced-by-other` (`locked_by_other`).
- The 15s in-progress lock prevents two concurrent syncs; `last_synced_at` drives the
  30s cooldown and advances only on success.

`complete_on_the_clock_sync(p_draft_id text, p_pick_count int, p_status text)`
```
update ... set last_synced_at = now(), sync_locked_until = null,
               pick_count = p_pick_count, draft_status = p_status, updated_at = now()
where sleeper_draft_id = p_draft_id;
```

`release_on_the_clock_sync(p_draft_id text)` (Sleeper failure path)
```
update ... set sync_locked_until = null, updated_at = now()
where sleeper_draft_id = p_draft_id;   -- does NOT advance last_synced_at
```

`try_claim_on_the_clock_lookup(p_ip text, p_username text, p_window_seconds int)` -
the leagues-route abuse guard, same claim-and-cooldown shape over a small ledger table
`on_the_clock_lookup_attempts (key text primary key, last_attempt_at timestamptz)`.

### RLS model (owner security requirements)
- `on_the_clock_settings`: RLS on, ONLY a service_role policy. No anon/auth access.
  Read server-side via `createAdminClient()`.
- `on_the_clock_draft_cache` and `on_the_clock_pick_cache`: RLS on.
  - SELECT: public (anon + authenticated). The data is public Sleeper draft data, and
    public SELECT is REQUIRED for Realtime (Postgres Changes is RLS-governed, so the
    anon subscriber must be allowed to read the rows). This is the "public read-only
    data" pattern from CLAUDE.md.
  - INSERT/UPDATE/DELETE: none for anon/auth. Writes happen only through the SECURITY
    DEFINER RPCs (which run as the table owner) and the service-role server route. The
    browser can never write a cache row or bypass the lock.
- `on_the_clock_lookup_attempts`: RLS on, service_role only (written by the RPC).
- Each migration carries the access-matrix comment at the top, and verification runs
  `pg_policies`, confirms anon cannot write, confirms anon CAN select the cache tables
  (needed for Realtime), and regenerates `lib/database.types.ts` (extract `.types`,
  prettier-format).

### Realtime (owner decision 5)
- Enable Realtime on `on_the_clock_pick_cache` (add to the `supabase_realtime`
  publication). The client subscribes via Postgres Changes filtered by
  `sleeper_draft_id=eq.{draft_id}` and merges INSERT/UPDATE rows into local state.
- Recommendation: Postgres Changes for MVP. It is the simplest path (the DB change IS
  the event, no extra publish step), RLS-governed, and more than adequate for per-draft
  viewer counts (a draft is tens of viewers, a pick every several seconds). Tradeoff:
  Postgres Changes checks each change against every subscription and shares a
  per-project event budget, so it does not scale to hundreds of concurrent subscribers
  on one draft. Migration path if that ever happens: switch to Broadcast via a database
  trigger (`realtime.broadcast_changes` on `on_the_clock_pick_cache`) to a per-draft
  topic, with topic authorization via RLS on `realtime.messages`. Documented as later
  scope; not built for MVP.
- Realtime NEVER fetches Sleeper. It only carries Supabase cache changes. Sleeper is
  touched solely by the sync route through the lock. Admin "Enable Realtime updates"
  can disable the subscription, in which case the room updates only on manual Sync.

### Cleanup / TTL (owner: active TTL + completed retention)
- A lightweight scheduled cleanup (a SQL function invoked by the existing cron, or a
  tiny `/api/cron/cleanup-on-the-clock`) deletes:
  - draft rows (cascade picks) where `draft_status = 'complete'` and `updated_at` older
    than admin "Completed draft cache retention" (default e.g. 7 days).
  - non-complete draft rows whose `last_synced_at` is older than admin "Active draft
    cache TTL" (default e.g. 24 hours) - abandoned/stale drafts.
- ABSOLUTE: cleanup is deletion only. NEVER wire per-draft recompute or per-league
  power-ranking work into this cron (matches the League Pulse cron rule).

### Saved username
- Unchanged. Persisted only when a signed-in user explicitly saves, via the existing
  owner-only-RLS `user_preferences.sleeper_league_settings` path. Anonymous users are
  never persisted. On The Clock adds no new username write path.

---

## 10. Performance plan (rev 2: Supabase shared cache, no polling)

### Sync model (replaces polling)
- The expensive Sleeper read happens at most once per draft per cooldown window
  (default 30s), regardless of how many viewers are watching, because the durable lock
  collapses all sync attempts to one. This is the core scalability win: Vercel holds no
  draft state; Supabase is the shared memory.
- First viewer to open a cold draft warms the cache (transparent sync on GET). Everyone
  after reads the cache. Any viewer can press Sync to refresh, bounded by the shared
  cooldown.
- Realtime fans new picks to co-viewers with no additional Sleeper or per-viewer DB
  query (the change payload carries the row).

### Read cost
- The read route returns shaped cache rows; the board (rankings + values) is fetched
  once per session and held client-side. Realtime updates only remove drafted ids and
  recompute the available set incrementally (O(delta)), recomputing recommendations
  only when the available set actually changes.
- Player-id mapping is done once at sync time and stored on the pick row, so neither the
  read path nor Realtime runs the mapping query per viewer.

### Caching specifics
- Static board (rankings/values for a format/source/season): cacheable, format/source
  -keyed, NEVER username-keyed; long `s-maxage` + stale-while-revalidate.
- Draft read route: short/no shared cache (cache rows change on sync); it is cheap (two
  indexed Supabase selects).
- Sync POST: never cached; guarded by the lock.
- Leagues route: per-username, `Cache-Control: private, no-store`; guarded by the
  durable lookup RPC.

### Optional auto-sync (default off)
An optional "auto-sync every N seconds" toggle may re-invoke the same locked sync on an
interval (still server-enforced cooldown, so it cannot hammer). Default off because
Realtime already keeps co-viewers current; manual Sync is the MVP default.

### Mobile
- Defer the board render until its tab opens. Lazy headshots. Paginated available list
  keeps the DOM small without virtualization.

---

## 11. Accessibility plan

- Keyboard: every control reachable and operable with visible focus; reuse existing
  dropdown disclosure components. View switcher is the APG tabs pattern with managed
  `tabindex` + `aria-controls`.
- Screen reader, list-first: available list and pick list are real tables with `scope`
  headers; the board is a native table with stable seat columns and serpentine pick
  numbers in cell labels (section 8). Decorative rings/icons `aria-hidden`.
- Live region (two channels):
  - polite region for others' picks and sync summaries.
  - assertive region (`role="alert"`) ONLY for "You are now on the clock".
  - Throttle/coalesce contract: catch-up/historical picks on first load and on
    tab-regain render SILENTLY into the list (never announced one by one). A sync or
    Realtime burst that adds multiple picks announces ONE coalesced summary ("3 picks
    made; you are on the clock in 2 picks"). `aria-atomic="true"`, replace not append.
- Focus contract: incoming picks (sync or Realtime) update the live region and lists but
  NEVER move focus. If the focused available-list row is the player just drafted out,
  move focus to the next sibling row and announce the removal. On view switch, move
  focus to the panel heading. On league-to-draft navigation, move focus to the draft
  view h1.
- Tables: `aria-sort` on the active sorted column header (a `<button>` inside the
  `<th>`); announce sort changes via the polite region; pagination/"Show more" controls
  announce the new visible count.
- Color independence: card labels, "Your pick", "On the clock", trend/tier/value chips
  all carry text or glyph + `aria-label`, never color alone.
- Reduced motion: the on-the-clock pulse is decorative; under `prefers-reduced-motion`
  the static cyan ring + "On the clock" text fully conveys state.
- One h1 per page, no skipped levels, skip-to-content + skip-to-pick-list links, 44x44
  targets, no data hidden at any breakpoint.

A sub-agent accessibility audit must verify the live-region throttle (no catch-up spam),
focus-not-stolen on sync/Realtime, the assertive "your turn" channel, the board table
headers under snake reversal, and the paginated-table-not-virtualized decision.

---

## 12. Security/privacy plan (rev 2)

- Username handling: sensitive context even though Sleeper is public. Never log full
  usernames; never echo another user's saved username. Leagues route is `private,
  no-store`; set `Referrer-Policy: no-referrer` on tool pages.
- Saved username: only persisted when signed in and explicitly saved, via existing
  owner-only-RLS path. Anonymous usage writes nothing. No new username write path.
- Cache tables hold only public Sleeper draft data (picks, public user ids, display
  names). No private user data lives on them. Public SELECT is intentional and required
  for Realtime; it is not an IDOR because the data is already public on Sleeper, and we
  never join the supplied username to a signed-in user's saved private data.
- Writes: the browser can never write a cache row or bypass the cooldown. All writes go
  through the SECURITY DEFINER RPCs and the service-role server route. The 30s lock is
  enforced in the database, not the browser and not Vercel memory. Two simultaneous Sync
  clicks resolve to exactly one Sleeper fetch (one claim wins; the other gets cache).
- Durable rate limiting: the sync lock IS the rate limiter for the expensive path; the
  leagues route uses the durable lookup-claim RPC (IP + normalized username). No
  in-memory limiter is relied upon. Header guard (`x-requested-with: ff-beacon`) is a
  CSRF-lite/bot filter only, not the control.
- Input validation, reject-before-fetch and before any RPC: `username`
  `^[A-Za-z0-9_]{1,32}$`, `season` `^[0-9]{4}$`, `league_id`/`draft_id`
  `^[0-9]{1,20}$`. Sleeper ids only ever become path segments against the hardcoded
  `https://api.sleeper.app` base in `lib/sleeper.ts` (no SSRF/path-traversal surface).
- Player-id filter: sanitize Sleeper ids to `^[A-Za-z0-9]{1,16}$` and build with `.in()`
  on the sanitized array (or a sanitized `.or()`), never raw concatenation. Unit-tested
  with a hostile-id fixture and DST ids.
- Env safety: service key only in server routes / server components via
  `createAdminClient()`; the client bundle never imports it (review gate). Publishable
  key client-side only. Settings read server-side only. The Realtime client uses the
  anon key and is bounded by RLS (read-only public cache rows).
- Response shaping: the read route serializes only whitelisted pick fields
  (first/last/position/team/round/pick/amount), with a hard row cap on the board.
- `updated_by` on settings is set from the verified admin session, never client input.

---

## 13. Edge cases

| Case | Handling |
|---|---|
| Username not found | null from `getSleeperUser` -> "We could not find a Sleeper user with that name." Keep form focused. |
| No active draft leagues | Empty state + Refresh. |
| Multiple active draft leagues | All shown, drafting first; user picks. No auto-select. |
| Selected league has no active draft | "No draft in progress right now." Back to picker + Refresh. |
| Draft not started (`pre_draft`) | Header + "Draft has not started yet"; Sync warms the cache once status flips. |
| Draft complete | Excluded from picker; if reached via stale link, "This draft is finished." |
| Auction draft | Board renders read-only (picks carry `amount`); recommendations run on remaining value; no budget helper. Banner notes read-only. |
| Linear / Snake / 3RR | `draft-shape` handles slot order; 3RR via `settings.reversal_round`, default snake + note when absent. Reversal is visual only; seat columns stay stable. |
| Keeper picks | `is_keeper` picks treated as drafted (removed) and tagged "Keeper". |
| Missing `picked_by` | Fall back to `roster_id`, then `slot_to_roster_id` + `draft_slot`. |
| Missing `roster_id` | Use `picked_by` -> roster; if both absent, "Team {slot}". |
| Co-owned teams | Match `owner_id` OR `co_owners[]`; My Draft includes co-owned picks. |
| Orphaned draft slots | "Open slot", never crash. |
| User's team cannot be detected | My Draft offers a slot picker; Team Need degrades (section 7). |
| Unmapped Sleeper players | Removed by name guard, rendered from cached pick metadata, no value chip, count surfaced. |
| Duplicate player names | Exclusion is by resolved `player_id`, never by name for mapped players. |
| Defenses / kickers | Present in board/list/picks/My Draft, removed when drafted; suppressed from recommendation except the late roster-need gate (section 7). DST team-code ids map via the sanitized lookup. |
| Rookie-only draft with non-rookie picks | Recommendations stay rookie-pool; any non-rookie drafted is still removed from the Everyone view. |
| Sync within cooldown | No Sleeper call; cache returned + "Synced N seconds ago" / "Next sync in M seconds". |
| Two viewers sync at once | One claim wins (one Sleeper fetch); the other gets cache + "Synced by another viewer". |
| Realtime disabled (admin) or connection drops | Room updates on manual Sync only; a subtle "live updates off" note; reconnect attempts are silent. |
| Cache cold on first open | Read route transparently performs one locked sync to warm it. |
| Rankings missing for season | Board/picks still render; value panels show "no rankings for {season} yet"; logged for admin/dev (section 9 season check). |
| Sleeper API fails on sync | `release_on_the_clock_sync` clears the lock without advancing `last_synced_at`; user can retry; soft error, never a crash. |
| Format could not be detected | Admin default fallback + banner + override. |
| Source does not support format | Pre-click warning + post-swap banner via the existing fallback. |

---

## 14. MVP acceptance criteria (testable without a real live draft)

Verifiable with fixtures/mocks:
1. Pure functions unit-tested against captured Sleeper fixtures:
   - format detection maps fixture leagues to the expected slug (incl. SF, TEP,
     dynasty/redraft).
   - `draft-shape` board coordinates for linear, snake, 3RR (stable seat columns,
     correct serpentine pick numbers).
   - `recommend`: Best Available = max raw value; Team Need uses VORP + slot-fill and
     returns the expected player for crafted SF / TEP / dynasty-seeded / rookie-pool
     fixtures; reach never vetoes a legitimate same-position need; DST/K suppressed
     until the late roster-need gate then surfaced; deterministic tie-break holds;
     component breakdown matches the deciding factor; Best-Available==Team-Need yields
     one aligned card. Validate default weights against >=2 formats (dynasty SF,
     redraft half-PPR) for sane picks.
   - `mapSleeperToPlayerIds`: partial map with one unknown id; DST team-code id ("BUF")
     and a kicker id both round-trip; hostile id is sanitized out.
   - active-draft league filter keeps drafting/paused, drops complete, marks pre_draft.
   - season check: with no rankings rows for the season, the loader returns the typed
     "no rankings" state (not a crash, not an empty board with no explanation).
2. Sync lock (against a test Supabase or the RPC in isolation): two concurrent
   `claim_on_the_clock_sync` calls yield exactly one `claimed=true`; a claim within the
   cooldown returns `claimed=false` with correct remaining seconds; `release` lets a
   retry claim sooner; `complete` advances `last_synced_at`. RLS: anon cannot write
   either cache table; anon CAN select them; settings table blocks anon entirely.
3. Routes with mocked Sleeper: leagues route enforces header guard, input regexes, the
   durable lookup guard, and `private, no-store`; sync route returns the documented
   status union; read route shapes only whitelisted fields.
4. Realtime (integration): inserting a pick row into `on_the_clock_pick_cache` for a
   subscribed `draft_id` delivers the change to a second client and updates its
   available set, with no Sleeper call.
5. Page renders every state from fixture props: no-username, username-not-found,
   no-active-leagues, league-no-draft, pre-draft, drafting-with-picks, cooldown-active,
   synced-by-other, rankings-missing-for-season, Sleeper-failure, realtime-off.
6. Accessibility: keyboard-only "draft from the list" completes; a catch-up burst does
   NOT spam the live region; focus is not stolen on a simulated sync/Realtime pick; the
   assertive channel fires only for "your turn"; the board table announces correct
   round/seat headers under snake reversal; axe/WCAG passes per state.
7. Admin settings round-trip through the server action against the new table; the tool
   reads the changed settings (cooldown, pools, DST/K gates, weights, TTLs).
8. Typecheck + lint clean; Signal Check / League Pulse / FAAB / Rankings / auth tests
   still pass.

Manual verification needing a real active draft (NOT claimed done until tested live):
- New picks appear after a Sync within one cooldown window and propagate to a second
  browser via Realtime with no extra Sleeper call.
- Two browsers pressing Sync within 30s cause exactly one Sleeper fetch.
- Team auto-detects from a real roster; dynasty roster seeding populates `have`.
- Format auto-detect and snake/3RR ordering match the real Sleeper board.

---

## 15. Suggested phased rollout

- Phase 1 - Plan + data audit (this document, rev 2).
- Phase 2 - Supabase cache foundation: migrations for the three tables + lock RPCs +
  RLS + Realtime publication; verify lock semantics and RLS with SQL tests. No UI yet.
- Phase 3 - Mocked UI + fixtures: all views against fixtures and a static board; get
  the visual + a11y (paginated table, native board, live-region contract) right.
- Phase 4 - Discovery flow: username -> leagues -> active-draft filter, durable lookup
  guard, dynamic season + rankings check.
- Phase 5 - Sync + cache wiring: `getSleeperDraftPicks`, sync route through the lock,
  read route, cache shaping, manual Sync button + status copy.
- Phase 6 - Realtime: pick-cache subscription, co-viewer fan-out, live-region
  announcements, realtime-off fallback.
- Phase 7 - Team Need engine: VORP + slot-fill + reach + DST/K gate, component
  breakdown, deterministic tests.
- Phase 8 - Admin settings: table + manager + nav tab; wire every tunable incl.
  cooldown, TTLs, DST/K gates, weights.
- Phase 9 - Polish + QA: accessibility audit, cleanup cron, copy review, sub-agent
  reviews resolved.
- Phase 10 (later) - Broadcast Realtime at scale, auction budget helper, ADP deltas,
  completed-draft review mode, share pages with privacy controls.

---

## 16. Sub-agent reviews

Five independent passes were run against rev 1. Their must-haves are now ADOPTED into
rev 2 (durable Supabase lock/cache instead of in-memory; split static board vs live
picks; dynamic season; paginated table + native board; VORP + slot-fill team need;
DST/K mapping + gate; explicit input validation and `.or()`/`.in()` sanitization). The
original review detail is retained below for traceability; the resolution status notes
how rev 2 addresses each.

### 16.1 Security / privacy review
Concerns: in-memory limiter is a non-control on Vercel; forgeable header guard;
username fan-out amplification; SSRF/`.or()` validation under-specified; username-keyed
CDN cross-leak; usernames in query-string logs; `updated_by` must be server-set.
Resolution in rev 2: the durable sync-lock RPC and the lookup-claim RPC replace the
in-memory limiter (sections 9, 12); explicit input regexes + `.in()` sanitization +
hardcoded Sleeper base (section 12); leagues route `private, no-store` + `Referrer-
Policy: no-referrer`; cache tables hold only public data with writes via SECURITY
DEFINER RPC / service role; `updated_by` server-set. Remaining accepted risk: usernames
still transit a GET query on the leagues route (documented, mitigated by no-referrer +
no-store); revisit a POST-body resolve if needed.

### 16.2 Performance / caching review
Concerns: per-instance in-memory caches; thundering herd; shared egress limit;
`picks_only` is not a wire delta; cache stampede; CDN cache defeated by mixed payloads;
fan-out N+1; per-poll rebuild cost; no jitter; per-viewer DB mapping.
Resolution in rev 2: Supabase shared cache + the durable lock collapse all viewers to
one Sleeper fetch per cooldown (singleflight by construction), replacing polling
entirely; Realtime carries deltas; player-id mapping done once at sync time and stored
on the row; static board split from live picks for caching; incremental available-set
recompute; jittered bounded concurrency on the leagues fan-out with a documented cap.

### 16.3 Accessibility review
Concerns: board grid under-specified; own-pick color-only; table-vs-virtualization
contradiction; live-region spam on catch-up; focus management absent; tabs vs segmented
ambiguity; mobile header hiding on-the-clock state; single live channel buries the turn
alert.
Resolution in rev 2: native board table with stable seat columns + serpentine labels;
textual "Your pick"; paginated semantic table, NO virtualization (owner decision 10);
explicit silent-catch-up + coalesced-burst live-region contract with `aria-atomic`;
written focus-never-stolen contract; APG tabs; mobile header always shows status +
on-the-clock + last pick; separate assertive channel for "your turn" (section 11).

### 16.4 Implementation architecture review
Concerns: hardcoded 2025 season; per-table source resolution flattened; DST numeric-only
mapping; thin draft object cannot infer SF/TEP; client/admin-client conflation; real
migration number; "pick delta" wording.
Resolution in rev 2: dynamic `currentNflSeason()` + rankings-rows check (sections 4, 5,
9); per-table source resolution replicated in the loader; DST/K mapping handled with
sanitized non-numeric ids + fixtures; format detection runs on the rich league entry;
anon client for public reads, service role only for settings/RPC; real next migration
number after a collision check; sync writes full picks, Realtime carries row deltas.

### 16.5 Recommendation logic / team-need scoring review
Concerns: two contradictory formulas; raw-value scale mismatch; reach penalty vetoes
the biggest need (bug); FLEX/SF deficit undefined; QB-to-SF unhandled; dynasty `have`
ignores returning roster; rookie math; scarcity/tiers unused; incomplete suppression;
overlapping knobs; reasons may not match the math.
Resolution in rev 2 (section 7): one canonical equation on 0-100 components; VORP
normalization; slot-fill for QB/RB/WR/TE/FLEX/SF with QB-to-SF; positional/tier-gated
reach (the veto bug is fixed); dynasty `have` seeded from cached Sleeper rosters with a
documented rookie-pool degrade; tier-cliff scarcity multiplier; deterministic
tie-breaks; DST/K gate wired into scoring; component breakdown drives the copy.

### 16.6 Cross-cutting must-haves (status)
1. Durable shared state for cache + limiting - ADOPTED (Supabase tables + lock RPCs).
2. Explicit input validation + `.in()`/sanitized `.or()` - ADOPTED (section 12).
3. Split static board vs live picks - ADOPTED (sections 9, 10).
4. Paginated semantic table + native board - ADOPTED (owner decision 10, sections 8, 11).
5. VORP + slot-fill team need before `recommend.ts` - ADOPTED (section 7).

---

## Resolved decisions (was: open questions)

All rev-1 open questions are now resolved by owner decision:

1. Source/format on a `/tools/` page: format draft/league-derived + overridable; source
   user-selectable with the standard fallback explained in the UI. (Decision 1.)
2. Persistence: Supabase-backed shared cache for active draft state (metadata + picks),
   not permanent per-user history and no share pages in MVP. (Decision 2.)
3. Cache + limiter location: Supabase, via cache tables and SECURITY DEFINER lock RPCs,
   server-enforced. No Vercel in-memory cache or limiter as the control. (Decision 3.)
4. Sync behavior: manual Sync Draft button, 30s server-enforced cooldown (admin
   configurable), cache returned within the window with clear copy. (Decision 4.)
5. Realtime: Supabase Realtime via Postgres Changes for MVP (simpler, RLS-governed,
   adequate at per-draft scale); Broadcast-via-trigger documented as the scale path.
   Realtime never fetches Sleeper. (Decision 5.)
6. Default pool: Rookies-only when a rookie draft is detected, always switchable to
   Everyone. (Decision 6.)
7. DST/K: present everywhere in the room; suppressed from recommendations until the
   late roster-need gate; admin-controlled; Sleeper team-code ids mapped + tested.
   (Decision 7.)
8. Best Available == Team Need: one aligned card on the same player, "Value and need
   align"; no demotion to a runner-up. (Decision 8.)
9. Season: dynamic `currentNflSeason()` / `getNflState()`, verify rankings rows for the
   season, graceful empty state + admin/dev signal when missing. (Decision 9.)
10. Available list a11y: paginated semantic table (no virtualization for MVP); board is
    a native table with stable draft-slot columns. (Decision 10.)
11. Team Need formula: VORP-normalized, one canonical equation, slot-fill roster model,
    SF/TEP handling, dynasty roster seeding with rookie-pool degrade, no penalizing a
    needed position, deterministic tie-breaks, component breakdown. (Decision 11.)

Required-before-implementation (owner's three), status:
1. Supabase shared cache/sync system - specified in sections 9, 10, 12.
2. Dynamic season handling - specified in sections 4, 5, 9, 13.
3. Smarter Team Need - specified in section 7.

## Proposed admin settings (full list)

`lib/on-the-clock/default-settings.ts`, single-row `on_the_clock_settings.settings`
jsonb, zod with per-field defaults (FAAB pattern), edited in the admin manager:

- Feature enabled / disabled
- Default ranking source
- Default format fallback
- Enabled player pools (Everyone, Rookies-only)
- Default player pool (auto from draft type, with this as the fallback)
- Sync cooldown seconds (default 30)
- Enable / disable Realtime updates
- Active draft cache TTL (default 24h)
- Completed draft cache retention (default 7d)
- Max active leagues returned per user
- Max available players shown before "Show more" (default ~100)
- Enable / disable team-need recommendation
- Team-need aggressiveness (Conservative / Balanced / Aggressive preset)
- Value weight (wValue)
- Need weight (wNeed)
- Reach penalty weight (wReach)
- Max acceptable reach (tier-break threshold for the positional reach gate)
- DST/K included in room (default on)
- DST/K recommend behavior (default: suppressed until roster-need)
- Allow DST/K recommendation only if the starting roster requires it (default on)
- Minimum round/pick before DST can be recommended
- Minimum round/pick before K can be recommended
- Superflex QB priority adjustment (multiplier)
- TE premium TE priority adjustment (multiplier)
- Position target fallback counts (when league `roster_positions` is missing/unmatched)
- Player-id mapping/mismatch admin visibility (a read-only panel listing recent unmapped
  Sleeper ids per draft, to spot ingestion gaps; no write capability)
