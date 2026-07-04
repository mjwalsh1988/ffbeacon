# Data Sources Taxonomy

The `source` column on `rankings`, `player_value_history`, `projections`, and similar
tables records the **provenance** of each row — where the underlying data came
from or which algorithm produced it.

Users **can** see source names in one place only: the header **Source**
dropdown, which lets them switch between data providers (KTC, FF Beacon
native, future providers). The visible identity is the registry's
`display_name`, never the raw slug. Everywhere else in the product the data is
presented as "Rankings", "Market value", etc. with no source attribution.

The point of the registry + column is so we can:

1. Mix sources over time without losing track of what came from where.
2. Replace or recompute a single source without disturbing the others.
3. Let users opt into the source they trust.
4. Migrate readers to a higher-quality source as we build native models.

## The `source_registry` table

`source_registry` is the single source of truth for which source labels exist
and how they're presented. Every source slug used by `rankings.source` or
`player_value_history.source` must have a matching row here.

| Column                   | Meaning                                                                  |
| ------------------------ | ------------------------------------------------------------------------ |
| `slug`                   | Primary key. Lowercase, hyphenless. Used in `rankings.source` etc.       |
| `display_name`           | Shown in the Source dropdown.                                            |
| `description`            | One-line hint shown under the name inside the dropdown.                  |
| `priority`               | Lower number = preferred default. Drives fallback order.                 |
| `is_active`              | Soft-delete flag. Inactive sources are hidden from the dropdown.         |
| `data_type`              | `text[]` of tables this source provides: `'rankings'`, `'player_value_history'`. |
| `supported_format_slugs` | `text[]` of `format_configs.slug` values this source genuinely provides distinct data for. `NULL` = supports every active format. |

## Current registry rows

| Slug          | Display Name | Priority | data_type                             | supported_format_slugs                                                                                                  | Status |
| ------------- | ------------ | -------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------ |
| `fantasycalc` | FantasyCalc  | 2        | `['rankings','player_value_history']` | `['redraft-std-std','redraft-half-std','redraft-ppr-std','redraft-ppr-sflex','dynasty-ppr-std','dynasty-ppr-sflex']`    | active |
| `ktc`         | KTC          | 3        | `['rankings','player_value_history']` | `['dynasty-ppr-std','dynasty-ppr-sflex','dynasty-ppr-tep-sflex','redraft-ppr-std','redraft-ppr-sflex']`                 | active |

Priority `1` is reserved for `ffbeacon` (FF Beacon's own original ranking
pipeline). The slot stays empty until we ship original logic; FantasyCalc and
KTC currently occupy `2` and `3` so future native rankings can slot in at the
top without renumbering.

### Format coverage matrix

|                        | redraft-std-std | redraft-half-std | redraft-ppr-std | redraft-ppr-sflex | redraft-ppr-tep | dynasty-ppr-std | dynasty-ppr-sflex | dynasty-ppr-tep-sflex |
| ---------------------- | :-------------: | :--------------: | :-------------: | :---------------: | :-------------: | :-------------: | :---------------: | :-------------------: |
| `fantasycalc`          | ✓               | ✓                | ✓               | ✓                 |                 | ✓               | ✓                 |                       |
| `ktc`                  |                 |                  | ✓               | ✓                 |                 | ✓               | ✓                 | ✓ (derived)           |

Coverage gaps are *intentional* — they reflect what each provider actually
publishes distinct data for, not what they list on their website. Adding a
checkmark requires the pairwise audit in
[Adding a new source](#adding-a-new-source).

### KTC supported format reduction (migration 0011, 2026-05-17)

Migration 0010 added `source_registry` with `ktc` as the sole row, and the
seed scraper wrote KTC values across **all 8 active `format_configs`**.
Migration 0011 reversed most of that. The scraper had been hitting KTC's
`fantasy-rankings` page with `?scoring=half`, `?scoring=std`, and `?tep=1`
as if those were server-side variants. They aren't — they're client-side
JavaScript filters that re-style the same PPR `playersArray` embedded in
the HTML. So four "different" formats were silently storing the same
numbers under different `format_config_id`s. A pairwise audit confirmed:

| Pair                                       | Shared players | Identical values |
| ------------------------------------------ | -------------- | ---------------- |
| `redraft-ppr-std`  ↔ `redraft-half-std`    | 350            | 350 (100%)       |
| `redraft-ppr-std`  ↔ `redraft-std-std`     | 350            | 350 (100%)       |
| `redraft-ppr-std`  ↔ `redraft-ppr-tep`     | 350            | 350 (100%)       |
| `redraft-half-std` ↔ `redraft-std-std`     | 350            | 350 (100%)       |
| `redraft-half-std` ↔ `redraft-ppr-tep`     | 350            | 350 (100%)       |
| `redraft-std-std`  ↔ `redraft-ppr-tep`     | 350            | 350 (100%)       |
| `dynasty-ppr-sflex` ↔ `dynasty-ppr-tep-sflex` | 518          | 474 (91.5% — TEs differ, expected) |

What migration 0011 did:

- Deleted **948 `player_value_history` rows** (316 per format × 3 fake formats) for
  `source='ktc'` in `redraft-half-std`, `redraft-std-std`, `redraft-ppr-tep`.
- Deleted **897 `rankings` rows** (299 per format × 3) for the same fake formats.
- Set `source_registry.ktc.supported_format_slugs` to the 5 truly distinct
  KTC datasets.

All 8 `format_configs` remain active — the change is purely about which
combinations of `(source, format)` are exposed in the UI. New sources can
fill in the redraft Half/Std/TEP formats later without code changes.

### KTC TEP+ is derived, not scraped

`dynasty-ppr-tep-sflex` rows are **algorithmically derived** from the
freshly-scraped `dynasty-ppr-sflex` batch on every sync. KTC publishes
TEP rankings as a client-side JavaScript transformation of their base
superflex values — the `?tep=1` URL returns the same embedded
`playersArray` as the base superflex URL, just rendered with TEP styling.
Scraping that toggle would produce duplicate (or near-duplicate) bytes
and trigger the same class of bug migration 0011 cleaned up.

Instead, `lib/ktc-tep.ts` reproduces the published formula
([reference implementation](https://github.com/ees4/KeepTradeCut-Scraper/blob/main/ktc_to_csv.py)):

```
s = 0.2
for each TE in dataset, sorted by value desc (te_rank = 0..N):
  t = t_mult * player_value
  n = (te_rank / (total_players - 25)) * r + (s * r)
  new_value = min(max_player_value - 1, round(t + n))
non-TE values are unchanged
then re-sort the whole dataset by value to re-rank
```

Tier constants come from KTC:

| Tier | `t_mult` | `r`  | TEP label | `format_configs.te_premium_bonus` |
| ---- | -------- | ---- | --------- | --------------------------------- |
| 1    | 1.1      | 250  | TEP+      | `0.5`                             |
| 2    | 1.2      | 350  | TEP++     | `1.0`                             |
| 3    | 1.3      | 450  | TEP+++    | `1.5` and above                   |

`tepTierFromTePremiumBonus()` maps the `format_configs.te_premium_bonus`
column to a tier so the formula reads "which TEP level is this format
asking for?" directly from the config. Today only TEP+ is in use
(`dynasty-ppr-tep-sflex.te_premium_bonus = 0.5`), but adding TEP++ or
TEP+++ is a single row insert plus an entry in
`DERIVED_FROM_SFLEX` in `scripts/sync-ktc.ts`.

`source_registry.ktc.supported_format_slugs` still lists
`dynasty-ppr-tep-sflex` because the source identity is unchanged: we're
applying KTC's own published math to KTC's own scraped data. We are not
introducing editorial opinion — that's reserved for
`source='ffbeacon'`.

Observed boost on the live data (top TEs, TEP+ tier):

| Player           | sflex value | tep-sflex value | Delta | %     |
| ---------------- | ----------- | --------------- | ----- | ----- |
| Brock Bowers     | 7947        | 8792            | +845  | +10.6% |
| Trey McBride     | 7499        | 8299            | +800  | +10.7% |
| Sam LaPorta      | 4533        | 5040            | +507  | +11.2% |
| Oronde Gadsden   | 3624        | 4042            | +418  | +11.5% |

Non-TE QB/RB/WR values pass through unchanged (391/391 verified). 443 of
468 ranked players shifted overall rank because the TE values now
interleave differently with QB/RB/WR. No cap-hits at top TEP+ today
(max sflex value is 9999, top TE TEP value is 8792).

## The `supported_format_slugs` contract

Every row in `source_registry` carries a `supported_format_slugs text[]`.
This list is the **single source of truth** for which formats a given
source actually publishes. It drives three behaviors:

1. **Format dropdown filtering** — when source X is selected, the Format
   dropdown hides every format that isn't in X's `supported_format_slugs`.
   (`components/format-toggle.tsx` accepts a `supportedFormatSlugs` prop;
   `components/site-header.tsx` and `components/mobile-menu.tsx` pass it.)
2. **Source dropdown warning (not filtering)** — when format Y is the current
   selection, the Source dropdown shows **every** active source but visually
   flags any source that doesn't list Y in its `supported_format_slugs`:
   a `(changes format)` note appears next to the name, the `aria-label`
   expands to "Warning: selecting this will switch your format from
   {Current} to {Fallback} because {Source} doesn't provide values for
   {Current}.", and a tooltip (`role="tooltip"`, linked via
   `aria-describedby`) appears inside the option with the fallback target.
   The user can still pick the warned source; `selectSource()` then performs
   the format swap and updates URL + cookie + DB. The point of the warning
   is to surface the consequence **before** the click, not just after. See
   `components/source-toggle.tsx`.
3. **Graceful fall-through** — when a user changes source via the dropdown
   to one that doesn't support the current format, the toggle picks a
   fallback format using `pickFallbackFormat()` and persists the swap to
   cookie/DB. When a user arrives at a page via a URL with
   `?format=<unsupported>`, `reconcileFormatWithSource()` from
   `lib/source.ts` picks the same fallback and renders a banner, but does
   **not** persist anything (URL is transient).

### Fall-through preference chain

Implemented in `lib/format-fallback.ts`. Given the current format and the
active source's `supported_format_slugs`, walk these filters in order
(each strictly narrows the previous pool; if a filter yields zero, fall
back to the previous pool):

1. Same `league_type` (redraft / dynasty)
2. Same `scoring_type` (ppr / half_ppr / standard)
3. Same `is_superflex`
4. Lowest `display_order` among remaining candidates

If none of the source's supported formats intersect the active set, the
helper returns `null` and the page renders the standard empty state.

### Banner behavior

- Source dropdown change → `aria-live` announcement + URL update + cookie/DB write.
- URL-driven mismatch → `role="status" aria-live="polite"` banner on the page
  body, no cookie/DB write. The banner text:
  `"Switched to <NewFormat> because <Source> doesn't provide values for <RequestedFormat>."`

### FantasyCalc (migration 0016, 2026-05-17)

FantasyCalc publishes trade values via a free public JSON API:

```
GET https://api.fantasycalc.com/values/current
  ?isDynasty={true|false}
  &numQbs={1|2}
  &numTeams=12
  &ppr={0|0.5|1}
```

No auth, no API key. The response is a JSON array of player objects of the
form (abbreviated):

```json
{
  "player": { "id": 9833, "name": "Bijan Robinson", "sleeperId": "9509",
              "position": "RB", "maybeTeam": "ATL", ... },
  "value": 10447,
  "overallRank": 1, "positionRank": 1,
  "trend30Day": -45,
  "redraftValue": 10447, "combinedValue": 20894,
  ...
}
```

`scripts/sync-fantasycalc.ts` hits the six combinations FantasyCalc actually
publishes distinct data for and writes `source='fantasycalc'` snapshots into
`player_value_history`. Player mapping resolves in three layers:

1. `players.external_ids.sleeper === FantasyCalc.player.sleeperId`
2. `players.slug` ends in `-<sleeperId>` (recovery path — Sleeper sync embeds
   the ID in the slug, and some rows are missing `external_ids.sleeper` from
   ordering issues during earlier syncs)
3. Normalized `name|position` match (last resort, mirrors `sync-ktc.ts`)

First production run match rate: **100% (1594/1594 rows matched)** across all
six formats. Most matches resolved via the slug-tail layer because
`external_ids.sleeper` is not consistently populated for every row today.

#### Why FantasyCalc has no TEP support

FantasyCalc does NOT publish TEP variants. Our `supported_format_slugs`
intentionally omits `dynasty-ppr-tep-sflex` and `redraft-ppr-tep`. If we
later want FantasyCalc-derived TEP, we'd apply our own TEP algorithm in the
sync pipeline (mirroring `lib/ktc-tep.ts` for KTC). That derivation is
explicitly not implemented in migration 0016 — adding it would be a separate
phase that ports a TEP formula or, more likely, builds an FF-Beacon-native
TEP adjustment, in which case the rows would be tagged `source='ffbeacon'`,
not `source='fantasycalc'`.

#### Pairwise verification (FC vs KTC)

For the four formats both sources cover, every FantasyCalc value differs
from the corresponding KTC value — 0% identical across 1,112 shared
player-format pairs, with average absolute differences ranging 1,240 to
3,329 value points. FantasyCalc and KTC are genuinely independent signals,
not skinned versions of the same dataset.

#### Pairwise verification (within FantasyCalc)

Per the "supported formats must yield distinct data" rule, all six declared
FantasyCalc formats were also pairwise compared. Highest pair overlap is
`redraft-std-std ↔ redraft-half-std` at 16.0% (low-value WRs/TEs where the
PPR difference is negligible — expected and acceptable). All other pairs:
0–1% identical. No collapsing variants. `MUST_DIFFER_PAIRS` in
`scripts/sync-fantasycalc.ts` enforces this on every run; the sync aborts
before writing if any declared-distinct pair collapses to 100% identical.

Other reserved slugs that may appear later:

- `ffbeacon` — FF Beacon's own original logic (editorial overlay, model blends,
  expert consensus). No rows use it yet.

### How `rankings.source` gets assigned

`scripts/seed-rankings.ts` is **source-generic**. It walks every active row in
`source_registry`, then for each of that source's `supported_format_slugs`:

1. Pulls the latest `player_value_history` row per player tagged with that
   source for that format.
2. Sorts by value descending.
3. Assigns `overall_rank`, `position_rank`, and a 6-tier bucket.
4. Upserts into `rankings` tagged with the same source slug.

Each ranking row's `source` matches the upstream value source — `'ktc'`,
`'fantasycalc'`, etc. The order is a deterministic restatement of the
provider's own value ordering, so the provenance is inherited unchanged.
When FF Beacon ships a ranking pipeline that does anything *original*
(editorial overlays, model blends), those rows will get
`source='ffbeacon'`.

The `rankings` table uses `UNIQUE NULLS NOT DISTINCT
(player_id, format_config_id, source, week, season)` (migration 0015), so
the upsert is idempotent — re-running the seed updates the snapshot in
place instead of doubling the row count.

## Selecting a source at read time

Pages do **not** hardcode `source='ktc'`. They use the helpers in
`lib/source.ts`:

- `readSourceSlug(searchParam)` — validates `?source=…` against
  `^[a-z0-9-]{1,64}$` and returns the slug or `null`.
- `getAvailableSources(supabase)` — returns active `source_registry` rows
  ordered by `priority`.
- `resolveSourceForFormat(supabase, table, formatConfigId, requestedSlug)` —
  probes `rankings` or `player_value_history` for which registered sources actually
  have data for that format, then returns:

  ```ts
  { source: string | null, requested: string | null, fellBack: boolean,
    availableForFormat: string[] }
  ```

  `source` is what the page should filter on. `fellBack` is true when the
  user's requested slug had no data for this format and we substituted a
  fallback. Pages render a banner using `describeSource(registry, slug)` to
  surface that substitution.

### Fallback rules

1. If the user picked a source via URL/localStorage and it has rows for the
   current format+table, use that source. No banner.
2. If the user picked a source and it has **no** rows for this format+table,
   fall back to the highest-priority source that **does** have data. Show a
   banner: *"No {Requested} data available for {Format}. Showing {Fallback}
   data instead."*
3. If the user didn't pick anything, use the highest-priority source with
   data. No banner.
4. If no source has data for this format+table, render the normal empty
   state.

The page should never render the empty state while a fallback is possible.

## Persistence priority chain (set-it-and-forget-it)

Source and format both follow the **same** four-layer resolution. Every page
that displays format-aware or source-aware data uses
`resolveSourceSlug` / `resolveFormatSlug` from `lib/preferences.ts`, which
walk this chain on the **server** so the first paint is always correct (no
flash of default content):

| Priority | Layer                                                | Who writes it |
| -------- | ---------------------------------------------------- | ------------- |
| 1 (top)  | URL `?source=…` / `?format=…`                        | Shareable links, dropdown selection |
| 2        | `user_preferences.default_source_slug` / `default_format_config_id` | Logged-in user via dropdown |
| 3        | Cookie `ffbeacon.source` / `ffbeacon.format`         | Dropdown selection (everyone) |
| 4        | Registry default (`source_registry` priority 1) / `DEFAULT_FORMAT_SLUG` | Hardcoded |

The dropdowns also write the selected slug to `localStorage` under
`ffbeacon.source` / `ffbeacon.format`. This is **write-only redundancy**: the
resolver chain above never reads from `localStorage` (it can't — server
components don't have access to it, and reading it client-side would
reintroduce the post-hydration flash this work was meant to eliminate).
`localStorage` is retained as a passive backup for manual recovery if cookies
get cleared while `localStorage` persists.

If a `?source=` / `?format=` value is present but fails the
`^[a-z0-9-]{1,64}$` regex, the URL layer is treated as **absent** and the
chain proceeds to layer 2 (DB → cookie → default). It is *not* treated as
"explicit default", so a logged-in user clicking a malformed share link still
sees their saved preference rather than getting bumped to the global default.

Cookie flags:
- `path=/`, `maxAge=1 year`, `sameSite=lax`
- `secure=true` in production
- `httpOnly=false` (client components can read; that's fine because the
  cookie carries only an already-public slug)

URL is a **transient override**: opening a shared link with `?source=xyz`
forces that view for that page render. We do not persist that override to the
cookie or to `user_preferences`, so navigating elsewhere returns to the
user's saved preference.

### Per-user-state behavior

| Scenario | Source / format resolved from |
| -------- | ---------------------------- |
| Brand-new anonymous user, no cookies | Registry default (currently `ktc` / `redraft-ppr-std`) |
| Anonymous user makes a selection | URL hit immediately, cookie set on selection, every subsequent page reads from cookie first paint |
| Anonymous user navigates between pages | Cookie at layer 3 (no flash) |
| User signs in with no `user_preferences` row | Cookie continues to drive layer 3 |
| User signs in and their saved DB pref differs from cookie | Auth callback (`app/auth/callback/route.ts`) overwrites cookie with DB value → cross-device sync |
| Logged-in user changes selection | Server action writes to cookie AND `user_preferences` |
| Logged-in user signs out | Cookie + localStorage retained → guest browsing continues with the last preference; DB row stays for next login |
| Anyone opens a `?source=xyz` link | Page renders with `xyz`, no persistence side-effects |
| Cookies + localStorage cleared | Falls through to registry default |

### Pages mark themselves dynamic

Every page that calls a resolver also exports
`export const dynamic = "force-dynamic"`. This is required because cookie
reads otherwise opt the route out of static generation, and we want the
behavior explicit. The trade-off is per-request rendering for these pages; in
exchange we get correct first-paint state across the entire site.

## Selecting a source from the UI

The header has a **Source:** dropdown (`components/source-toggle.tsx`)
positioned immediately to the left of the **Format:** toggle. It mirrors the
format toggle's visual treatment and ARIA pattern (`listbox` + `option`,
`aria-expanded`, ESC closes, click-outside closes, focus returns to trigger,
`aria-live` announces the change).

Persistence:

- URL — `?source=<slug>` (validated against the registry).
- Local — `localStorage['ffbeacon.source']`.
- Account — `user_preferences.default_source_slug` (logged-in users only),
  written via the `saveSourcePreference` server action in
  `app/actions/preferences.ts`. The action validates the slug against
  `source_registry` and `auth.users` and is RLS-protected by the existing
  `user_preferences_*_own` policies.

When only one source is active, the dropdown trigger is `disabled` and the
caret is hidden, so it reads as a static label rather than a one-option menu.

## Adding a new source

1. **Build the import pipeline** that inserts rows into `rankings` and/or
   `player_value_history` with the new source slug.
2. **Pairwise-verify format-specific data.** Before declaring which formats
   the new source supports, pull a fresh dump for every format you claim
   and run the same pairwise audit migration 0011 used:

   ```sql
   WITH pairs AS (
     SELECT a.format_config_id AS fa,
            b.format_config_id AS fb,
            COUNT(*) AS shared,
            SUM(CASE WHEN a.value = b.value THEN 1 ELSE 0 END) AS identical
     FROM player_value_history a
     JOIN player_value_history b
       ON a.player_id = b.player_id
      AND a.format_config_id < b.format_config_id
     WHERE a.source = '<new-source>' AND b.source = '<new-source>'
     GROUP BY 1, 2
   )
   SELECT fc_a.slug, fc_b.slug, p.shared, p.identical,
          ROUND(100.0 * p.identical / NULLIF(p.shared, 0), 1) AS pct_same
   FROM pairs p
   JOIN format_configs fc_a ON fc_a.id = p.fa
   JOIN format_configs fc_b ON fc_b.id = p.fb
   ORDER BY pct_same DESC;
   ```

   Any pair that reports `pct_same = 100` is the source telling you it
   doesn't actually support both formats — drop one of them from
   `supported_format_slugs` before inserting the registry row.

3. **Insert a row into `source_registry`** with the verified
   `supported_format_slugs`:

   ```sql
   insert into public.source_registry
     (slug, display_name, description, priority, data_type, supported_format_slugs)
   values
     ('fantasycalc', 'FantasyCalc',
      'Community-trade-driven dynasty + redraft values.',
      2,
      ARRAY['rankings','player_value_history'],
      ARRAY['redraft-ppr-std','redraft-half-std','redraft-std-std',
            'dynasty-ppr-std','dynasty-ppr-sflex']);
   ```

4. **Update `pickRankingsSource` priority list if needed** — only relevant
   if you want the new source to outrank an existing one for a format both
   support. The default fallback is `source_registry.priority` ascending.

5. **That's it.** The Format dropdown will start hiding unsupported formats
   when the user is on this source, and the Source dropdown will start
   hiding this source for formats it doesn't support. No component code
   change required.

To hide a source temporarily without dropping its rows, flip its
`is_active` to `false`. To shrink (or expand) the list of formats a source
covers, update `supported_format_slugs` directly; the dropdowns and
fall-through logic pick it up on the next request.

## Future Sources

When adding **<Source>**:

1. Implement the import script (mirror `scripts/sync-ktc.ts`, including
   the `ALLOWED_<SOURCE>_FORMAT_SLUGS` allow list and the `MUST_DIFFER_PAIRS`
   sanity check).
2. Pairwise verify format-specific data using the SQL above.
3. Set `supported_format_slugs` to the formats that actually differ.
4. Insert into `source_registry` with the appropriate `priority`
   (lower = preferred default).
5. Update the `pickRankingsSource` priority list if you want this source
   to outrank an existing one for any shared format.

## Where source filtering is applied

Every query against `rankings` or `player_value_history` filters by `source` using
the resolution helpers. The pages that do this today:

- `app/rankings/page.tsx`
- `app/players/page.tsx`
- `app/players/[slug]/page.tsx` (cross-format ranking grid + the format-pinned
  trade-value pill)
- `app/tools/faab/page.tsx`
- `scripts/seed-rankings.ts` (source-generic — reads `player_value_history`
  for every active `source_registry` row, writes `rankings` tagged with the
  same source slug, e.g. `ktc` rows + `fantasycalc` rows in one pass)
- `app/actions/preferences.ts` (validates a slug exists in the registry
  before persisting it to `user_preferences`)

Any future page that reads from `rankings` or `player_value_history` **must** go
through `resolveSourceForFormat`. Do not hardcode a source slug.

## Raw source payloads (`metadata` jsonb)

Every external-ingestion table carries a `metadata` jsonb column that
preserves the original raw object from the source for each row:

- `player_value_history.metadata` — the KTC `playersArray` entry (or future
  source's per-player payload) at the moment we captured this value snapshot.
- `rankings.metadata` — provenance for derived rankings (e.g.
  `{ derived_from: { table: "player_value_history", source_slug: "ktc" }, input_value: 9999 }`).
- `projections.metadata` — raw projection payload from the source.
- `player_stats.metadata` — full Sleeper weekly stat object.
- `news_items.metadata` — the raw RSS/source object.
- `players.metadata` — multi-source map keyed by source slug:
  `{"sleeper": {...full Sleeper player object...}, "ktc": {...}}`.

Sync scripts MUST populate `metadata` at insert time. For canonical tables
like `players` where one row aggregates multiple sources, the sync script
reads the existing `metadata` map first and merges its own source key in,
so other sources' payloads aren't clobbered by the upsert. See
`scripts/sync-sleeper-players.ts` for the canonical merge pattern.

`players` additionally carries:

- `source_synced_at` — jsonb map keyed by source slug, e.g.
  `{"sleeper": "2026-05-17T...", "ktc": "2026-05-16T..."}`. Replaces the
  former `last_sleeper_sync` / `last_ktc_sync` columns.
- `internal_attributes` — FF Beacon editorial / curated attributes
  (slug overrides, manual tags). Replaces the former `our_metadata`.

Why this matters: we never want to be in a position where a value looks
wrong and we can't reconstruct what the source actually told us. The
metadata column is also the substrate for re-deriving fields later if we
decide to extract something we initially ignored. See CLAUDE.md
"Data Architecture Principles" for the full rule.

## Pre-calculated trends (`player_value_trends`)

`player_value_trends` is a **derived** table — one row per
`(player_id, format_config_id, source)` — populated by
`scripts/calculate-trends.ts`. It is NOT an external-ingestion table and
therefore does NOT carry a `metadata` jsonb column. Its provenance is the
calculation script.

Schema (see migration `0013_player_value_trends.sql`):

| Column            | Type         | Notes |
| ----------------- | ------------ | ----- |
| `current_value`   | numeric      | Latest snapshot in `player_value_history` for this combo. |
| `value_7d_ago` / `value_30d_ago` / `value_90d_ago` | numeric, nullable | Closest snapshot at or before the target date. NULL when history doesn't reach back that far. |
| `change_7d` / `change_30d` / `change_90d` | numeric, nullable | Absolute delta. NULL when the corresponding `*_ago` is NULL. |
| `change_7d_pct` / `change_30d_pct` / `change_90d_pct` | numeric, nullable | Percent delta. |
| `trend_7d` / `trend_30d` | text, nullable | `'up'` / `'down'` / `'stable'` using a ±2% threshold against percent change. |
| `volatility_30d` | numeric, nullable | Population stddev across snapshots in the 30-day window. |
| `high_30d` / `low_30d` | numeric, nullable | Min/max value within the 30-day window. |
| `data_points_30d` | int          | Count of history snapshots in the trailing 30 days. UI gates display on this. |
| `updated_at`     | timestamptz  | When the row was last recomputed. |

### Recalc cadence

`player_value_trends` is recalculated after every value sync. The
package.json wires it into two chains:

```
npm run sync:ktc:full
# = npm run sync:ktc && npm run seed:rankings && npm run calculate:trends

npm run sync:full
# = npm run sync:ktc && npm run sync:fantasycalc && npm run seed:rankings && npm run calculate:trends
```

`sync:full` is the canonical nightly entrypoint. `sync:ktc:full` is kept as
a single-source escape hatch for refreshing only KTC (e.g. when probing a
KTC-specific bug). `seed:rankings` and `calculate:trends` are source-generic
already, so the same chain accommodates every source listed in
`source_registry` without further changes.

Triggers (Postgres triggers, that is) are intentionally NOT used — the
recalc is a deliberate scripted step so we can run it independently for
debugging and avoid surprise lock contention on the history table.

### Data scarcity handling

When `player_value_history` doesn't reach back far enough for a window,
the corresponding `*_ago`, `change_*`, and `trend_*` fields are NULL.
UI consumers gate display on `data_points_30d` (default threshold: 7).
The `<TrendChip>` component and the rankings table's `TrendCell` both
render `—` when the threshold isn't met, with an `aria-label` of
"Insufficient history for 7-day trend".

## Historical backfill

Some sources expose enough public history that we can populate
`player_value_history` with **real past snapshots** instead of waiting
weeks or months for the daily sync to accumulate trend data. Backfill is
a **one-time** operation per source — it is intentionally NOT in the
nightly cron.

### KTC dynasty + redraft (`scripts/backfill-ktc-history.ts`)

`POST https://keeptradecut.com/dynasty-rankings/histories` and
`POST https://keeptradecut.com/fantasy-rankings/histories` both return
the same shape: an array of `{ playerID, oneQB, superflex }` objects
where each format section carries four encoded-string arrays
(`valueHistory`, `tepHistory`, `teppHistory`, `tepppHistory`). Each
encoded string is `YYMMDDVVVV+` — 2-digit year, month, day, then the
integer value. The DPC project's `lib/ktc-decode.ts` decoder is the
canonical reference.

The request body is `'"1"'` (a JSON-encoded `"1"`). We probed alternate
bodies (`"0"`, `"7"`, `"30"`, `"365"`, `null`) — all return identical
bytes, so the body is effectively a placeholder. No auth, no rate
limiting observed. The endpoint returns the entire dataset in one
response (~3 MB dynasty, ~1.8 MB redraft).

Date range observed at first backfill (2026-05-17):

| Endpoint                            | Players | Earliest      | Latest        | Snapshots (both formats) |
| ----------------------------------- | ------- | ------------- | ------------- | ------------------------ |
| `dynasty-rankings/histories`        | ~500    | 2025-11-18    | day-of-fetch  | ~168,000                 |
| `fantasy-rankings/histories`        | ~378    | 2026-01-01    | day-of-fetch  | ~98,000                  |

Format mapping (FF Beacon native slugs):

| Endpoint                  | Section     | Beacon `format_configs.slug` |
| ------------------------- | ----------- | ---------------------------- |
| `dynasty-rankings`        | `oneQB`     | `dynasty-ppr-std`            |
| `dynasty-rankings`        | `superflex` | `dynasty-ppr-sflex`          |
| (derived)                 | n/a         | `dynasty-ppr-tep-sflex`      |
| `fantasy-rankings`        | `oneQB`     | `redraft-ppr-std`            |
| `fantasy-rankings`        | `superflex` | `redraft-ppr-sflex`          |

`dynasty-ppr-tep-sflex` history is **derived from each historical
dynasty-ppr-sflex daily snapshot** via `applyKtcTep()` in
`lib/ktc-tep.ts`, identical to the live daily sync path. We do NOT
read KTC's published `tepHistory` array because (a) it only contains a
subset of dates and (b) the live sync derives algorithmically too, so
the derivation must match across historical and current rows for trend
continuity. Source stays `'ktc'` because the data origin is unchanged.

KTC publishes no TEP arrays for redraft and we do not host a
`redraft-ppr-tep-sflex` format, so no redraft TEP derivation runs.

Player matching mirrors `sync-ktc.ts`: name + position lookup against
`players`. The histories endpoint omits names, so we additionally fetch
the public rankings pages to extract each `playerID`'s `playerName` +
`position` from the embedded `playersArray`. Unmatched IDs are logged
to `/tmp/backfill-ktc-unmatched.json` for manual review.

Idempotency: the script writes via Supabase upsert with
`onConflict: 'player_id,format_config_id,source,captured_at'` and
`ignoreDuplicates: true`. Re-runs are no-ops. `captured_at` is set to
UTC noon on the historical date so a given calendar day maps to a
single canonical timestamp.

### Sleeper draft market (ADP + projections): `player_market_snapshots`

`scripts/sync-sleeper-market.ts` (lib at `lib/sync-sleeper-market.ts`, cron at
`/api/cron/sync-sleeper-market`, nightly 11:00 UTC) pulls Sleeper's
undocumented-but-stable season projections endpoint:

```
GET https://api.sleeper.com/projections/nfl/{season}
  ?season_type=regular&position[]=DEF&position[]=K&position[]=QB
  &position[]=RB&position[]=TE&position[]=WR&order_by=adp_ppr
```

Note the host: `api.sleeper.com`, no `/v1` prefix. One call returns ~3,300
players; each row's flat `stats` map carries season projection points
(`pts_ppr` / `pts_half_ppr` / `pts_std` plus component stats) and ADP keys for
every format Sleeper publishes (`adp_ppr`, `adp_half_ppr`, `adp_std`,
`adp_2qb`, `adp_dynasty_ppr`, `adp_dynasty_half_ppr`, `adp_dynasty_std`,
`adp_dynasty_2qb`, `adp_idp`, `adp_idp_1qb`, `adp_rookie`, `adp_dynasty`).
`999` is Sleeper's "no data" sentinel and is stripped at ingest. Rows with no
real ADP and no projection are not stored (~600-800 stored per night).

This data intentionally does NOT flow through `source_registry` /
`player_value_history`: it is draft-market data (ADP), not a trade-value
source, and Sleeper must never appear in the public Source dropdown. The
`player_market_snapshots.source` column ('sleeper') is provenance only.
`player_market_latest` (a security_invoker view) serves current lookups.

**No historical access exists.** The endpoint serves current values only; every
plausible historical variant is absent (this mirrors the FantasyCalc finding
below). Consequence: ADP history accumulates from launch (2026-07-04) forward.
On The Clock's historical draft-snapshot lookups treat pre-launch dates via the
documented fallback chain (nearest snapshot after the date, else current data,
always flagged in snapshot metadata).

### FantasyCalc historical — not publicly accessible

FantasyCalc exposes `GET /values/current` only. We probed every
plausible historical variant (path-based `/values/<date>`,
`/values/historical`, `/values/historic`, `/charts`, `/trends/values`,
`/values/snapshots`, plus query-string `?date=…`, `?asOfDate=…`,
`?daysAgo=…`, `?dayOffset=…`, `?startDate=…`). All historical-shaped
paths return 404. Interestingly the `?date=` *query key* is the only
one that triggers a 404 instead of being ignored, which suggests
FantasyCalc once had `?date=`-based historical access and disabled it
behind the same route. Either way: no public access today.

Consequence: FantasyCalc trend data accumulates from launch date
(2026-05-17) forward. UI consumers already gate display on
`player_value_trends.data_points_30d`, so the missing FC trends render
as `—` until ~30 days of FC syncs have run. KTC trends, by contrast,
render from the first post-backfill rankings page load.

### Running the backfill

```
# KTC only (via KTC's /histories endpoint, ~6 months of history):
npm run backfill:ktc

# KTC + trend recalculation (the canonical post-backfill chain):
npm run backfill:all
# = npm run backfill:ktc && npm run calculate:trends

# Deeper KTC history via the community archive (2024-01-01 onward by default):
npm run backfill:ktc:community
npm run backfill:ktc:community -- --since 2023-06-01
```

No corresponding `backfill:fantasycalc` script ships, because there is
nothing to fetch. If FantasyCalc later publishes a historical endpoint,
add a script that follows the same idempotency + match-and-upsert
pattern as `backfill-ktc-history.ts` and wire it into `backfill:all`.

### KTC pre-`/histories` backfill via community archive

`scripts/backfill-ktc-community-archive.ts` (lib at `lib/backfill-ktc-community-archive.ts`)
ingests the community-maintained Google Sheet by u/325xi5mt
(https://docs.google.com/spreadsheets/d/1n5aqip8iFCpltO8deiS7q9m3u_dFvKTZpwzfZXVTpgs).
That sheet snapshots the top 500 KTC values daily and has retained values
since 2020-04-01 — far deeper than KTC's own `/histories` endpoint, which
only returns ~6 months. Companion scraper at github.com/ees4/KeepTradeCut-Scraper.

What we ingest from the sheet:
- `1QB Historical Data` tab → `dynasty-ppr-std` values
- `SF Historical Data` tab → `dynasty-ppr-sflex` values
- `dynasty-ppr-tep-sflex` is derived per-date via `applyKtcTep()` from the
  sflex bucket, identical to the live sync pipeline.

What we deliberately skip:
- Pick columns (`2024 Early 1st`, `2025 Late 2nd`, etc.) — they don't map
  cleanly to our `(season, round, slot)` schema; live sync handles picks.
- FantasyCalc columns — they're current-snapshot, not historical (the sheet
  overwrites them daily, no archive).
- Redraft history — not in the sheet.
- Players ranked below 500 historically — sheet only tracks top 500.

Player matching mirrors `sync-ktc.ts`:
1. Read positions from the sheet's current `1QB` snapshot tab (this gives
   a `name -> position` map for every historical player).
2. For each historical cell with a value, look up `players` by
   `normalizeName(name) + position`.
3. Unmatched names are logged but non-fatal (mostly retired/inactive players
   no longer in our `players` table).

Idempotency: upsert on `(player_id, format_config_id, source, captured_at)`
with `ignoreDuplicates: true`. `captured_at` is `YYYY-MM-DDT12:00:00.000Z`,
identical to `scripts/backfill-ktc-history.ts`, so the two backfills coexist
without duplicate rows.

ABSOLUTE RULE: This is a one-time bootstrap. Do NOT add it to the nightly
cron. The live `/api/cron/sync-ktc` already handles forward-going writes.

Provenance: each row's `metadata` carries
`{ ktc_community_archive: { source: "u/325xi5mt google sheet", sheet_id,
tab, date, column_header, raw_value } }` so the data is distinguishable
from rows written by `backfill-ktc-history.ts` (which carries
`{ ktc_historical: {...} }`) or by the live sync (which carries the raw
KTC `playersArray` object).

Cross-validation against KTC's own `/histories` data shows ≤0.15% value
drift per row (rounding + snapshot timing differences).

### Read pattern

Pages read trend indicators **directly from `player_value_trends`**, not
by recomputing from `player_value_history` at request time. This is the
"pre-calc table" rule from CLAUDE.md Data Architecture Principles: derived
tables exist for performance.
