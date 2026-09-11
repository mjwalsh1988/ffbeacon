# Beacon Steals: draft value against the market

Plan of record. Written 2026-08-12, before any code existed.

Beacon Steals answers one question for every drafted player, in every format we
carry: **is the market letting him fall past where he is actually worth taking?**

It compares three things we already own and nobody publishes together:

1. FF Beacon's value opinion (the asset)
2. FF Beacon's competitive opinion (projected points, beat rate, availability)
3. Where the player is actually drafted (Sleeper's ADP, plus our own synced rooms)

The output is a per-(player, format) score, a category, and a plain-language
verdict, rebuilt nightly and read by the draft guide and by the live draft room.

---

## 1. What the audit found

Numbers below are from the live database on 2026-08-12.

### Draft picks we already hold

| Source | Drafts | Picks | Notes |
| --- | ---: | ---: | --- |
| `on_the_clock_pick_cache` | 40 with picks (49 cached) | 7,552 with a resolved `player_id` | 524 distinct players, 317 drafted 10+ times |
| `on_the_clock_pick_snapshots` | 18 finalized | 4,464 | 3,974 already carry both a Beacon rank and a Sleeper ADP frozen at pick time |
| `league_drafts` (League Pulse) | 157 rows, 120 complete | **0** | metadata only; picks were never stored |

**99 completed League Pulse drafts have no picks anywhere.** At roughly 180
picks each that is on the order of 18,000 picks we have permission to fetch and
were discarding. Recovering them is the single largest free data win in the
plan, and it is the reason Phase 0 comes first.

34 of the 157 League Pulse drafts overlap with an On The Clock draft, so the
canonical ledger must dedupe on `sleeper_draft_id` regardless of which path
ingested it.

### Market ADP

`player_market_snapshots` holds two ADP sources:

- `sleeper`, daily since 2026-07-04 (40 snapshots), 10 market keys in the `adp`
  jsonb: `ppr`, `half_ppr`, `std`, `2qb`, `dynasty_ppr`, `dynasty_half_ppr`,
  `dynasty_std`, `dynasty_2qb`, `idp`, `idp_1qb`. Between 310 and 360 players
  per key.
- `dynastyprocess`, the rookie market (`rookie` key), back to 2023-07-07.
  113 rookies in the latest snapshot.

Season projections ride along on the same rows: 633 of 675 players in the latest
Sleeper snapshot carry `projected_pts_ppr` / `_half_ppr` / `_std`.

`lib/on-the-clock/adp.ts adpFormatKeyCandidates` already maps an FF Beacon
format slug plus a player pool to an ordered list of ADP keys, and it already
enforces the two hard rules (dynasty never borrows redraft, superflex never
borrows single-QB). Beacon Steals reuses it verbatim rather than reimplementing
the mapping.

### Our own player numbers

- `rankings` + `player_value_history` + `player_value_trends`, source `ffbeacon`,
  for every active format. 805 ranked players in `dynasty-ppr-sflex`, ~415 in
  the redraft boards.
- `player_projection_accuracy`: `beat_rate`, `availability_rate`,
  `shrunk_multiplier`, `ratio_stdev`, per (player, season, scoring) plus a
  blended NULL-season row. 716 players career-wide, 610 for 2025, 552 for 2024.
- `player_weekly_projections` (24,545 rows) and `player_positional_finishes`
  (48,615 rows).
- The Power Pulse projection model (`lib/power-pulse/project.ts`) and the exact
  optimal-lineup solver (`lib/power-pulse/lineup.ts`), already used by On The
  Clock through `lib/on-the-clock/projection-board.ts`.

### The guide slot

`/guides` already advertises a **"2026 fantasy football draft guide"** as a
coming-soon card whose bullets promise "sleepers, value picks, and the players
we're fading" and "the value the room keeps passing on". Beacon Steals is the
engine that card was always describing. The guide is the launch surface.

---

## 2. Two traps, found by running the naive version against live data

Before designing anything, the obvious implementation (sort by
`sleeper_adp - beacon_overall_rank`) was run against production. It fails twice,
and both failures are structural rather than cosmetic.

### Trap 1: the deep board is noise

Top results for `dynasty-ppr-sflex` against the `dynasty_2qb` market:

| Player | Beacon rank | Sleeper ADP | Raw gap |
| --- | ---: | ---: | ---: |
| De'Zhaun Stribling | 132 | 289.2 | +157.2 |
| Eli Raridon | 190 | 325.3 | +135.3 |
| Carson Beck | 135 | 239.1 | +104.1 |
| Caleb Douglas | 236 | 338.8 | +102.8 |

Every one of them sits past pick 230 in a market that only ranks ~360 players.
Both numbers are guesses that deep, and the raw difference grows precisely where
confidence collapses. A naive sort fills the top of the board with players
nobody has an opinion on.

### Trap 2: it flags every quarterback

Top results for `redraft-ppr-std` against the `ppr` market, restricted to
ADP 60-180:

| Player | Pos | Beacon rank | Sleeper ADP | Raw gap |
| --- | --- | ---: | ---: | ---: |
| Fernando Mendoza | QB | 100 | 169.5 | +69.5 |
| Cam Ward | QB | 106 | 165.9 | +59.9 |
| Patrick Mahomes | QB | 51 | 100.1 | +49.1 |
| KC Concepcion | WR | 97 | 143.2 | +46.2 |
| Bo Nix | QB | 78 | 118.7 | +40.7 |

Six of the top twelve were quarterbacks. This is not a discovery, it is an
artifact. FF Beacon's `overall_rank` is a **cross-position value** rank. ADP is a
**scarcity price**. In a one-QB league nobody spends pick 50 on QB8 no matter how
good he is, so the two numbers disagree on every quarterback, every time, in every
single-QB format.

### The fix, and it fixes both

Do not compare a value rank to a pick number. Convert both sides into the same
currency first, which is **where a player should come off the board given what a
league actually has to start**, then compare pick numbers to pick numbers. Then
gate the result on a confidence score that collapses exactly where Trap 1 lives.

Section 4 specifies the currency. Section 5 specifies the confidence.

### Trap 3, found during the build: the two sides were still on different scales

Added after implementation. The first working version of section 4 compared a
LADDER INDEX to an ADP, and those are not the same unit either. A ladder over N
players tops out at N; the market it was being compared against ran deeper. Under
that mismatch every player deep in the market reads as an enormous steal purely
because the ladder cannot produce a number that large.

It made the quarterback artifact **worse than the naive implementation it was
meant to fix**: 10 of the top 12 instead of 6.

The fix is `projectOntoMarketScale` in `lib/draft-value/engine.ts`. Rather than
comparing numbers, it redistributes: take the pick slots the market actually
spent, sort them, and hand them out in our ladder order. `beacon_pick` becomes
"the pick this player would go at if the room drafted the same players in our
order", both sides are the same unit by construction, and the answer no longer
depends on how deep our board happens to run.

### Trap 4, also found during the build: whole positions, not players

Even with the scarcity ladder, a points-above-replacement model wants elite
quarterbacks earlier than a one-QB room takes them. That is the long-running
argument between value-over-replacement models and real draft behaviour, not a
bug, and it is the wrong thing for a steal list to relay: "the market is late on
this player" has to mean late relative to COMPARABLE players. A uniform +20 on
every quarterback is a strategy claim, and it belongs in the guide's prose.

So the engine subtracts each position's MEDIAN gap before ranking (median rather
than mean, so a few genuinely mispriced players cannot drag the correction and
hide themselves). Stored as `position_adjusted_gap` in migration 0192.
`value_gap` keeps the raw arithmetic, because that is what the verdict sentence
quotes and a reader can check it against the two picks either side.

Two consequences worth knowing:

- A row's raw gap and centered gap can disagree in SIGN. Nine rows shipped that
  way on the first build: Brock Purdy, going at 36.2 against our pick 40.1, sat
  under a "Steals" heading carrying the sentence "the room is spending 4 picks
  too early on him". The verdict now adds a clause explaining the positional
  offset whenever the two diverge, instead of contradicting its own bucket.
- Centering could also lift a player with no competitive case at all. A backup
  quarterback going at pick 238 who projects 182 points BELOW a replacement
  starter came out as a steal. `categorize` now requires a steal to have either a
  positive points-above-replacement or none measured at all, which is the same
  test the swing bucket already applied.

---

## 3. Schema

Six migrations as built, `0188` through `0193`. The plan specified four; `0192`
adds `position_adjusted_gap` for trap 4 above, and `0193` adds a distinct-format
view plus pick-capture state, both from the review pass. Their own headers carry
the reasoning.

### 0188 `draft_selections` (ingestion)

One row per pick made in any draft we have ever synced, from any ingestion path.
This is the canonical ledger; `on_the_clock_pick_cache` remains the live-room
working cache and is not replaced.

```
id                  uuid pk
sleeper_draft_id    text not null
pick_no             integer not null
round               integer
draft_slot          integer
roster_id           integer
picked_by           text
sleeper_player_id   text
player_id           uuid references players(id) on delete set null
is_keeper           boolean not null default false

-- draft context, denormalized so the ADP build is one indexed scan
sleeper_league_id   text
season              integer not null
draft_type          text          -- snake | linear | auction
draft_status        text
format_slug         text          -- the FF Beacon format this draft maps to
player_pool         text          -- everyone | rookies
teams               integer
rounds              integer
drafted_at          timestamptz   -- draft start_time when known

ingest_source       text not null -- on_the_clock | league_pulse
metadata            jsonb not null default '{}'  -- raw Sleeper pick object
created_at, updated_at

unique (sleeper_draft_id, pick_no)
```

Indexes on `(format_slug, player_pool, season)`, `(player_id)`,
`(sleeper_draft_id)`.

**RLS: `service_role` only.** No client reads this table. It carries
`picked_by` (a Sleeper user id) and the full raw pick object, and every consumer
is a server-side aggregation. Least privilege wins over the "public read-only
data" default because there is no public consumer.

`metadata` preserves the raw Sleeper pick object per the Data Architecture
Principles.

### 0189 `draft_market_adp` (derived)

Our own ADP, computed from `draft_selections`.

```
format_slug   text not null
player_pool   text not null
season        integer not null
player_id     uuid not null references players(id) on delete cascade
drafts_sampled  integer not null   -- drafts in the cohort
picks_sampled   integer not null   -- drafts in which THIS player was taken
adp             numeric not null   -- mean pick number
adp_median      numeric not null
earliest_pick   integer not null
latest_pick     integer not null
pick_stdev      numeric
draft_rate      numeric not null   -- picks_sampled / drafts_sampled
computed_at     timestamptz not null default now()
primary key (format_slug, player_pool, season, player_id)
```

Derived, so no `metadata` column. `service_role` only.

### 0190 `draft_value_settings` (config)

Single pinned row, `id = 'global'`, `settings jsonb`, `updated_at`,
`updated_by`. `service_role` only, admin-edited, code fallbacks in
`lib/draft-value/default-settings.ts`. Same shape as
`league_power_pulse_settings` and `on_the_clock_settings`.

### 0191 `draft_value_targets` (the product)

```
format_slug        text not null
season             integer not null
player_id          uuid not null references players(id) on delete cascade

-- market side
market_adp         numeric        -- the ADP actually used
market_adp_key     text           -- which key it came from
market_source      text           -- sleeper | dynastyprocess
room_adp           numeric        -- ours, null when unsampled
room_drafts_sampled integer

-- beacon side
beacon_rank        integer        -- raw overall value rank
beacon_value       numeric
beacon_pick        numeric        -- WHERE WE'D DRAFT HIM (the currency)
position_rank      integer

-- competitive side
projected_points   numeric
points_above_replacement numeric
beat_rate          numeric
availability       numeric

-- output
value_gap          numeric        -- market_adp - beacon_pick
steal_score        numeric        -- 0..100
confidence         numeric        -- 0..1
category           text           -- steal | swing | fade | fair
verdict            text           -- the plain-language sentence
model_version      text not null
computed_at        timestamptz not null default now()
primary key (format_slug, season, player_id)
```

**RLS: public SELECT, `service_role` write.** This is the published product and
the guide renders it.

---

## 4. The currency: `beacon_pick`

`beacon_pick` is the answer to "where would FF Beacon draft this player", on the
same axis as ADP. It is built per format, per season.

### Step 1: league shape from the format slug

The format slug carries scoring and superflex-ness but not roster size, so the
shape comes from settings with per-format overrides:

```
teams: 12
starters: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 0, DEF: 0 }
superflexAddsQb: true      -- +1 QB starter when the slug contains "sflex"
```

Flex demand is distributed across RB/WR/TE by a settings-driven share
(`{ RB: 0.45, WR: 0.45, TE: 0.10 }`), which is close to how flex slots actually
get filled and keeps tight ends from absorbing a full slot they never win.

### Step 2: replacement level per position

```
demand(pos) = teams * (starters[pos] + flexShare[pos] * starters.FLEX)
replacementPoints(pos) = the demand(pos)-th best projected season total at pos
```

Projected season totals come from `player_market_snapshots.projected_pts_*` on
the latest snapshot, choosing the column that matches the format's scoring base.
TE-premium formats add the settings TE bonus per reception using the same
`bonus_rec_te` logic the league scorer applies, rather than inventing a
multiplier.

A position with no projection data is skipped entirely. Absent is not zero: a
missing projection means no opinion, never a zero-point player.

### Step 3: points above replacement, adjusted for reliability

```
par(player) = projectedPoints * reliability * availability - replacementPoints(pos)
```

DEVIATION FROM THE ORIGINAL PLAN, which specified `max(0, ...)`. The clamp is
wrong: it collapses every sub-replacement player into a single tie and destroys
the whole tail of the par ladder, which is exactly where a late-round board
lives. The implementation is unclamped and `categorize` handles the
below-replacement case explicitly instead.

`reliability` and `availability` come from `player_projection_accuracy`
(blended NULL-season row, matching the format's scoring base), each clamped by
settings, each defaulting to 1.0 when the player has no history. Rookies
therefore neither gain nor lose from this term.

### Step 4: two pick ladders

- **`parPick`**: sort every projectable player by `par` descending; the index
  (1-based) is that player's points-driven pick number.
- **`valuePick`**: sort every ranked player by FF Beacon value descending within
  the format; the index is that player's value-driven pick number. This is just
  `overall_rank` restricted to draftable positions.

### Step 5: blend by league type

```
beacon_pick = wValue * valuePick + wPoints * parPick
```

Weights are settings, defaulted by league type:

| League type | wValue | wPoints | Why |
| --- | ---: | ---: | --- |
| redraft | 0.35 | 0.65 | This season's points are the whole game |
| dynasty | 0.70 | 0.30 | A 22-year-old with modest current points is still the asset |

A player present in only one ladder uses that ladder alone, with the missing
side recorded so confidence can dock it.

**This is what kills Trap 2.** `parPick` already prices scarcity: in a one-QB
league only 12 quarterbacks are needed, so QB13 sits far down the `par` ladder no
matter how many raw points he scores. Mahomes stops looking like a 49-pick steal
because `beacon_pick` now says roughly what ADP says.

### Step 6: the gap

```
value_gap = market_adp - beacon_pick
```

Positive means the market lets him fall past where we would take him. This
matches the existing sign convention in `lib/on-the-clock/adp.ts`
(`pickValueDelta = pick_no - adp`, positive = value), so a number means the same
thing in the draft room and on the guide.

---

## 5. Confidence, and the categories

### Confidence, 0 to 1

The product of four factors, each a setting:

1. **Market depth.** Full credit while `market_adp <= marketTrustedDepth`
   (default 200), decaying linearly to `marketFloor` (default 0.25) at the
   deepest ADP present in the snapshot. This is the direct fix for Trap 1.
2. **Value depth.** Full credit while `beacon_rank <= valueTrustedDepth`
   (default 250), decaying the same way.
3. **Competitive data.** 1.0 with both a projection and a graded beat-rate
   history, 0.8 with a projection only, 0.55 with neither.
4. **Room agreement.** 1.0 by default. When our own `draft_market_adp` has at
   least `roomMinDrafts` (default 5) samples for the player, the factor rises
   toward `roomAgreementMax` (1.15, clamped so total confidence stays <= 1) when
   our rooms also let him fall, and falls toward 0.85 when our rooms take him
   much earlier than the public market.

A player below `minConfidence` (default 0.35) is stored but never categorised as
a steal.

### Steal score, 0 to 100

The gap is meaningless in absolute picks across formats (30 picks is 2.5 rounds
in a 12-team league and a different thing in an 8-team room), so it is expressed
in **rounds** first:

```
gapRounds  = value_gap / teams
raw        = clamp(gapRounds / stealSaturationRounds, -1, 1)   -- default 3 rounds
steal_score = round(50 + 50 * raw * confidence)
```

50 is neutral. Above 50 the market is late on him, below 50 it is early.
Multiplying by confidence pulls uncertain players toward neutral instead of
letting them top the board.

### Categories

| Category | Rule |
| --- | --- |
| `steal` | `gapRounds >= stealMinRounds` (1.0) and `confidence >= minConfidence` |
| `swing` | `market_adp >= lateRoundPick` (100) and `par > 0` and `gapRounds >= swingMinRounds` (0.5), regardless of confidence |
| `fade` | `gapRounds <= -fadeMinRounds` (1.0) and `confidence >= minConfidence` |
| `fair` | everything else |

`swing` is deliberately the loose bucket. A late-round dart is allowed to be
uncertain; that is what makes it a dart. It is labelled as such in the copy.

### The verdict sentence

Built by `lib/draft-value/verdict.ts`, deterministic, no AI. Shape:

> "Goes around pick 96 in PPR. We'd take him at 61, and he projects 42 points
> above a replacement starter. Beats his weekly projection 53% of the time."

Every clause is dropped when its input is missing rather than filled with a
placeholder, so a rookie with no history simply gets a shorter sentence.

---

## 6. Ingestion and rebuild

### Writing selections

`lib/draft-selections.ts` exposes `recordDraftSelections(admin, params)`. Two
callers:

1. **On The Clock.** `performDraftSync` calls it after the pick-cache upsert,
   inside a try/catch. A ledger failure must never fail a live draft sync.
2. **League Pulse.** The draft sync fetches picks **only for drafts whose status
   is `complete` and which have no rows in `draft_selections` yet**. That makes
   it one extra Sleeper call per draft ever, not per pulse. Also non-fatal.

Format and pool are derived once at write time using the existing
`lib/sleeper-to-format.ts` and `lib/on-the-clock/draft-derive.ts` helpers, from
the league object we already fetch. A draft whose format cannot be derived is
still stored with `format_slug` null; it simply never enters an ADP cohort.

### Backfill

`scripts/backfill-draft-selections.ts`, `npm run backfill:draft-selections`.
Two passes:

1. Copy every row of `on_the_clock_pick_cache`, joined to
   `on_the_clock_draft_cache` for context.
2. For every `league_drafts` row with `status='complete'` and no selections,
   fetch picks from Sleeper with a polite delay between drafts.

Idempotent through the `(sleeper_draft_id, pick_no)` unique constraint.
**One-time. Never wired into a cron.**

### Rebuild chain

`npm run calculate:draft-value` runs both stages:

1. `runBuildRoomAdp` -> `draft_market_adp`
2. `runBuildDraftValue` -> `draft_value_targets`

Nightly via `/api/cron/rebuild-draft-value` at 15:00 UTC, after the market sync
(11:00), weekly projections (12:00), and the derived recalc (10:00), so every
input is same-day fresh.

---

## 7. Surfaces

Three, and explicitly **not** a standalone `/tools` page. That was cut from
scope by the owner.

### On The Clock available-players list

`lib/on-the-clock/adp.ts describeBeaconVsAdp` currently compares raw
`overall_rank` to ADP, which carries Trap 2 into the live draft room. The room
gains the real steal score and verdict where a target row exists, falling back to
the existing rank comparison when it does not. This is the highest-value surface:
it is advice while someone is actually on the clock.

### `/guides/fantasy-football-draft-guide`

The launch surface. Server-rendered, no year in the URL (a dated slug would need
redirecting every August, the same reasoning the glossary page documents).
Evergreen strategy prose wrapped around auto-updating lists pulled from
`draft_value_targets`: steals, late-round swings, and fades, per format, with a
format switcher. Registered in `lib/guides/published.ts` so the sitemap and
`llms.txt` pick it up, and the coming-soon card on `/guides` becomes a link.

### `/admin/draft-value`

Settings editor for every weight, threshold, and league shape above, mirroring
`/admin/power-pulse`. Saving does not fan out a recompute; bumping
`modelVersion` forces the next nightly rebuild to rescore everything.

---

## 8. Rules this build must satisfy

- **Format sync.** Every surface resolves format through the normal chain
  (`resolveFormatSlug`). Inside a league view the league's own derived format
  wins, per the League Pulse Format Resolution rule.
- **Source.** The value side is forced to `ffbeacon`, matching On The Clock and
  Signal Check, because the whole feature is our opinion against the market. The
  market side is labelled by display name, never a raw slug.
- **Mobile-first.** No data hidden at any breakpoint. The guide lists use a
  stacked two-line row rather than a wide table that sheds columns.
- **Accessibility.** The verdict sentence is the primary output and the numbers
  are secondary, so a screen reader gets the conclusion without assembling it
  from table cells. Format switching is a real link set, not a JS-only control.
- **RLS in the same migration** as every table, with the access matrix documented
  at the top of the file.
- **Time display** through `lib/datetime.ts` wherever a computed-at date shows.

---

## 9. Deferred, on purpose

- **Standalone `/tools/beacon-steals` page.** Cut by the owner for now. Every
  piece it would need exists once this ships; it is a page, not a project.
- **Backtesting against `player_positional_finishes`.** We have DynastyProcess
  ADP back to 2023 and real finishes back further, so grading last year's version
  of this board and publishing the hit rate is possible. It is its own phase.
- **Rookie-pool boards.** The room-ADP builder produces `player_pool='rookies'`
  cohorts (492 rows across 4 formats today) and `adpFormatKeyCandidates` already
  emits the `rookie` key for that pool, but the board builder only builds the
  `everyone` pool. `selectMarketAdp` takes a pool argument so the wiring is one
  call away; nobody has decided what a rookie-draft guide section should say yet.
  Until then the DynastyProcess branch of `marketLabel` is unreachable.
- **Auction drafts.** `draft_selections` stores them (`draft_type = 'auction'`)
  but pick-number ADP is meaningless for them, so they are excluded from ADP
  cohorts until an auction-value model exists.
- **Caching the guide page.** It is `force-dynamic` with five index-backed reads
  per request (the bucket read measures 2.9ms). The content changes once a day,
  so `unstable_cache` around the two loaders would take the steady-state cost to
  zero. Not done: the page has to stay dynamic regardless, because
  `resolveFormatSlug` reads cookies.
- **SQL-side room ADP.** `runBuildRoomAdp` loads the whole ledger into memory to
  aggregate it (21,000 rows today). Fine now; the eventual fix is a group-by in
  Postgres, keeping the tested pure function as the reference implementation.
- **IDP.** The market publishes `idp` and `idp_1qb` keys and we rank no IDP
  players, so those keys are never selected.
