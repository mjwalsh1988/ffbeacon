# Signal Check (Beacon Verdict) trade analyzer

Built 2026-06-25. This is the primary engineering reference for the Signal
Check feature: what it is, how it is laid out, the exact math, the privacy
model, and how to extend it.

## TL;DR

Signal Check is FF Beacon's own trade evaluation tool. A user builds a trade
(players, plus draft picks in dynasty formats) on each of two sides and gets
the "Beacon Verdict": who wins, by how much (a percentage margin), the trade
shape, a confidence level, and a plain-language explanation. It is powered by
FF Beacon Values only in V1 (no public source selector). Every number is
computed server-side through a deterministic, traceable pipeline; results can
be frozen and shared via an unguessable permalink with a branded OG image.
Admins tune behavior through DB-backed settings, a versioned calibration rules
engine, and a regression test set.

Public feature name: **Signal Check**. Result name: **Beacon Verdict**.

## Core invariants (do not break these)

1. **FF Beacon Values only in V1.** Player and pick values come from the
   `ffbeacon` source. There is no public value-source selector. Pick values
   fall back to KTC only if a dynasty format has no `ffbeacon` pick rows.
2. **Draft picks are dynasty-only.** `format_configs.league_type === 'dynasty'`
   is the single determinant (`ResolvedFormat.allowsPicks`). Redraft formats
   (including the bestball-redraft ones) never carry picks: the search endpoint
   returns no pick results, the builder hides picks, the server rejects
   submitted picks, and Sleeper imports drop picks with a notice.
3. **Everything is computed server-side.** The client submits only asset
   references (player uuids, pick descriptors) and a format slug. No
   client-supplied value, total, margin, verdict, rule id, ruleset version, or
   role is ever trusted.
4. **The engine is deterministic and trace-first.** Same inputs + same settings
   + same ruleset version always produce the same output. Every value
   adjustment emits a trace entry.
5. **No LLM per analysis.** Explanations are generated from structured trace
   templates.
6. **Privacy via `public_payload`.** Private/debug columns are never exposed.
   Public surfaces render only the pre-built `public_payload` object. See
   "Privacy model" below.

## File map

```
lib/signal-check/
  types.ts            Domain contracts (AssetInput, PricedAsset, RuleTraceEntry,
                      BeaconVerdict, SignalCheckSettings, PublicSharePayload, ...)
  versions.ts         VALUE_ENGINE_VERSION, RULE_INTERPRETER_VERSION (frozen into analyses)
  errors.ts           SignalCheckError (typed, surfaced to users)
  template.ts         renderTemplate() does safe {placeholder} substitution (no eval)
  values.ts           buildValueResolver(): DB-backed player + pick value loader
  format.ts           resolveFormat(), supportedFormats(); FF Beacon source constants
  value-engine.ts     priceSides(): per-asset base value + value-engine trace
  calibration.ts      applyCalibration(): post-format asset rules
  trade-shape.ts      applyTradeShape(): pile-on + side rules + shape detection
  verdict.ts          computeVerdict(): margin formula + neutral/blowout
  confidence.ts       computeConfidence(): factor-weighted score -> level
  explanation.ts      buildExplanation(): plain-language from the trace
  pipeline.ts         runPipeline(): orchestrates all phases
  settings.ts         loadSignalCheckSettings(), loadActiveRuleset(), loadRulesetById(); DEFAULT_SETTINGS
  freeze.ts           freezeAnalysis(), buildPublicPayload() (the privacy boundary)
  builder-view.ts     toBuilderView(): serializable view for client surfaces
  rules/
    schema.ts         Zod schemas (rule, condition, action, analysis input)
    interpreter.ts    matchCondition(), applyValueAction(), applySideAction(), selectApplicableRules()
  *.test.ts           Vitest suites (run: npm test)

app/tools/signal-check/
  page.tsx                       Public builder page (server)
  signal-check-builder.tsx       Builder client (sides, format, run, share, ResultPanel)
  asset-autocomplete.tsx         Accessible combobox (players + dynasty picks)
  actions.ts                     runSignalCheck server action
  v/[shareId]/page.tsx           Public share page (reads public_payload only)
  import/page.tsx                Sleeper import page (auth-gated, server)
  import/import-wizard.tsx       Import wizard client
  import/actions.ts              listImportLeagues, listLeagueTrades, importAndAnalyze

app/api/signal-check/search/route.ts        Public autocomplete endpoint
app/api/og/signal-check/[shareId]/route.tsx OG share image (public_payload only)

app/admin/signal-check/
  page.tsx                       Settings (reuses SettingField + audited action)
  actions.ts                     updateSignalCheckSetting, ruleset/rule actions
  regression-actions.ts          upsert/delete/run regression
  rules/page.tsx + rules-manager.tsx
  regression/page.tsx + regression-manager.tsx
components/admin/signal-check-subnav.tsx     Settings / Rules / Regression subnav

supabase/migrations/
  0100_signal_check_rulesets.sql      rulesets + rules
  0101_signal_check_analyses.sql      frozen analyses (+ public_payload)
  0102_signal_check_regression_cases.sql
  0103_signal_check_audit_log.sql
  0104_signal_check_settings_seed.sql beacon_settings rows (signal_check* categories)
```

## Data model + RLS

Five new tables (migrations 0100-0104). Scalar settings live in the existing
`beacon_settings` KV table under `signal_check*` categories.

| Table | Purpose | RLS |
| --- | --- | --- |
| `signal_check_rulesets` | Versioned calibration container; exactly one `is_active` (partial unique index) | service-role only |
| `signal_check_rules` | Structured JSON rules (condition/action), editable only while ruleset is `draft` | service-role only |
| `signal_check_analyses` | Frozen, reproducible results; holds private + `public_payload` | owner SELECT own + service-role; **no anon, no public SELECT** |
| `signal_check_regression_cases` | Known trades + expected outcomes | service-role only |
| `signal_check_audit_log` | Append-only admin audit trail | service-role only |

Key columns on `signal_check_analyses`: reproducibility pins
(`value_source_slug`, `value_engine_version`, `rule_interpreter_version`,
`ruleset_version`, `format_slug`, `format_config_id`,
`format_detection_evidence`), frozen payload (`input_assets`, `raw_values`,
`adjusted_values`, `side_totals_pre`, `side_totals_post`, `rule_trace`),
outputs (`trade_shape`, `confidence`, `verdict_label`, `winner_side`,
`margin`), private `sleeper_context`, the public-safe `public_payload`,
`value_captured_at`, `created_at`, `public_share_id` (unique), `is_public`.

Admin reads/writes go through `createAdminClient()` after `requireAdmin`, the
same pattern as `beacon_settings`. The public engine reads the active ruleset
and settings via the service role inside the server action.

## The deterministic pipeline

`lib/signal-check/pipeline.ts runPipeline()` runs these phases in order. Each
phase is a separate module with its own trace; format, calibration, and
trade-shape logic never mix.

```
priceSides            resolve format_config_id, read FF Beacon current_value
(value-engine)        (players) / draft_pick_values (picks); 1 trace entry/asset
   |
applyCalibration      post_format_calibration rules per asset (compounding +
   |                  stackability + max-adjustment guardrails)
   |  -> side totals (pre)
applyTradeShape       1) pile-on (built-in, once per side, capped)
   |                  2) one_side post_aggregation rules (side penalty/boost)
   |                  3) trade-shape label detection (+ assign_shape overrides)
   |  -> side totals (post)
computeVerdict        margin = abs(A-B)/(A+B); neutral threshold; blowout
computeConfidence     factor-weighted 0..100 score -> low/medium/high
buildExplanation      plain-language sentences from the trace (no LLM)
```

"Format weighting" is NOT a math transform: FF Beacon values are already
format-specific (TEP/superflex/PPR are baked into the format slug). The value
engine resolves the right `format_config_id` and records the format in the
trace.

### Margin (exact)

```
margin = abs(final_A - final_B) / (final_A + final_B)   (expressed as a percent)
```

Displayed at `signal_check_margin_precision` (default 1 decimal). The neutral
threshold is applied to the UNROUNDED margin so display rounding can never flip
a near-even call. `A + B <= 0` returns neutral without dividing by zero.

### Neutral / blowout

`margin < signal_check_neutral_threshold` (default 2.5%) -> neutral label
(default "Near even"), no winner. `margin >= signal_check_blowout_threshold`
(default 20%) sets `isBlowout`. The decisive label is rendered from
`signal_check_win_template` ("Side {side} wins by {margin}% of total trade
value.").

### Pile-on (built-in, settings-driven)

Applied once per side in the trade-shape phase, only when
`signal_check_pileon_enabled` and the side has at least
`signal_check_pileon_min_assets` (default 3) assets:

1. Sort the side's post-calibration adjusted values descending.
2. The top `signal_check_pileon_top_k` (default 2) keep full value.
3. Each asset beyond K is depreciated by `curve_base^(index_beyond_K)`
   (`signal_check_pileon_curve_base`, default 0.9); the penalty is the sum of
   the lost value.
4. The total penalty is capped at `signal_check_pileon_max_penalty` percent
   (default 25%) of that side's pre total.
5. Exactly ONE side-level trace entry is emitted. Pile-on never boosts the
   other side and is never combined with an asset-level pile-on (there is none).

### Compounding

`signal_check_compounding_mode`: `sequential` (each percent applies to the
running value) or `against_base` (each percent applies to the original base).
Default `sequential`. Rule MATCHING always uses base values (deterministic
thresholds); APPLICATION moves the running value.

### Stackability

`stackable=true` rules compound within a phase. Non-stackable rules that share
a non-null `stack_group` are mutually exclusive: the first by `sort_order`
applies, the rest are skipped with a trace note. Non-stackable rules with a
null `stack_group` always apply.

### Trade-shape detection (deterministic)

Ordered checks using settings thresholds, first match wins (an `assign_shape`
rule can override): near_even -> roster_clog (pile-on fired) -> stud_swap
(1-for-1 players) -> pick_heavy / win_now -> consolidation (one big asset for a
package) -> depth. Each key maps to an admin-editable label
(`signal_check_shape_*`). Labels surface in the verdict, share, and OG.

### Confidence

`computeConfidence()` starts at 60 and adjusts: + separation (margin),
- picks (noisier), - missing values, - assumed pick bucket, + clean Sleeper
detection, - material pile-on, + admin rule confidence_modifiers. Clamped
0..100, mapped to low (<= `confidence_low_max`, default 40) / high
(>= `confidence_high_min`, default 70) / medium otherwise.

## Rules engine

Rules are structured JSON validated by Zod (`rules/schema.ts`) and interpreted
by a deterministic switch (`rules/interpreter.ts`). There is NO eval, Function
constructor, or expression string anywhere.

- Phases: `post_format_calibration` (asset-level), `post_aggregation_trade_shape`
  (side/whole-trade).
- Scopes: `single_asset`, `one_side`, `whole_trade`.
- Conditions (all present filters must pass): positions, formats, assetKinds,
  minValue/maxValue, pickRounds/pickSeasons, minAssetCount/maxAssetCount,
  minSideTotal/maxSideTotal, min/maxBestAssetShare, tradeShape.
- Actions (one per rule): `multiply_pct`, `add_points`, `cap_value` (asset);
  `side_penalty_pct`, `side_boost_pct` (side); `assign_shape`,
  `confidence_modifier`, `trace_note`. Scope/phase/action coherence is enforced
  by a Zod `superRefine`.
- `max_adjustment` ({type: pct|points, value}) caps the magnitude of any single
  rule's adjustment.

Rules live in a versioned ruleset. Workflow: create a draft ruleset -> add/edit
rules (editable only while `draft`) -> publish (sets `is_active`, freezes the
ruleset) -> rollback re-points `is_active` to a prior published version. The
single-active invariant is enforced by clearing the old active row before
setting the new one. A published ruleset is immutable so any frozen analysis
that pinned its version stays reproducible. With no active ruleset, the engine
still runs using built-in pile-on + shape detection (zero rules is valid).

## Settings

All scalar tunables are `beacon_settings` rows under categories `signal_check`,
`signal_check_verdict`, `signal_check_pileon`, `signal_check_shape`,
`signal_check_confidence`, `signal_check_format`. `DEFAULT_SETTINGS` in
`settings.ts` mirrors the seed so the engine and tests run without a DB and a
missing row degrades to a sensible default. The admin Settings page renders one
`SettingField` per row and saves through the audited `updateSignalCheckSetting`.

## Format + source resolution

`format.ts resolveFormat(slug)` returns a `ResolvedFormat` only when the slug
is active AND in FF Beacon's `source_registry.supported_format_slugs`.
`supportedFormats()` is the manual builder's list = FF Beacon supported, active,
minus `signal_check_disabled_formats`. `allowsPicks = league_type === 'dynasty'`.
`values.ts buildValueResolver()` batches player meta + values
(`player_value_trends.current_value` for the format, source `ffbeacon`) and
pick values (`draft_pick_values`, ffbeacon, KTC fallback). An unknown pick
bucket resolves to a generic season+round average (never a guessed bucket).

## Public builder + autocomplete

`/tools/signal-check` renders two sides, a format selector (all FF Beacon
formats), and `/tools/signal-check` calls the `runSignalCheck` server action.
The autocomplete (`asset-autocomplete.tsx`) is a WAI-ARIA combobox (arrow/Enter/
Escape, `aria-activedescendant`, `aria-live` result count). It calls
`/api/signal-check/search`.

`runSignalCheck(input, { save?, makePublic? })`: loads settings + active
ruleset (admin client), Zod-validates the input, resolves the format, builds
the resolver, runs the pipeline, returns a `BuilderView`. When `save`, it
freezes the analysis and inserts the row, returning a share URL. Picks in a
redraft format throw `SignalCheckError` (caught, surfaced cleanly).

## Public autocomplete endpoint

`GET /api/signal-check/search?q=&format=&limit=`. Public, returns ONLY safe
fields (player: name/position/team/sleeperId; pick: season/round/position/label).
Never returns values or private fields. Abuse safeguards (no DB rate limiter by
design): `x-requested-with: ff-beacon` header check, minimum query length
(`signal_check_autocomplete_min`, default 4, configurable down to 3), hard
result clamp, indexed/parameterized query, sanitized input. Pick suggestions
are returned ONLY for dynasty formats.

## Share + OG + privacy model

`signal_check_analyses` holds private/debug columns (`user_id`,
`sleeper_context`, `raw_values`, `adjusted_values`, `side_totals_*`,
`rule_trace`). RLS is row-level, not column-level, so there is deliberately NO
anon/public SELECT policy. Instead, `freeze.ts buildPublicPayload()` produces a
single `public_payload` jsonb containing only the safe summary (feature/result
labels, verdict label, winner side, margin, format display, trade-shape label,
confidence label, explanation, per-side asset display names, optional totals
only when `signal_check_show_raw_values` is on, snapshot label, created date).

The public share page (`v/[shareId]/page.tsx`) and the OG route
(`/api/og/signal-check/[shareId]`) read server-side via `createAdminClient()`,
select only `public_payload` + `is_public`, and render only `public_payload`,
and only when `is_public = true`. A private or unknown id renders the not-found
UI (with `robots: noindex`). The OG image is FF Beacon brand only (dark bg,
purple->cyan gradient, "FF Beacon" wordmark, "ffbeacon.com"); no DPC gold, no
`#0c0c18`. Cached `public, max-age=300, s-maxage=3600, stale-while-revalidate=86400`.

Verified: a saved analysis with a private `sleeper_context` secret does not
leak that secret (or raw points) into `public_payload`.

## Sleeper import (logged-in)

`/tools/signal-check/import` (auth-gated). Uses the user's saved Sleeper
username (`user_preferences.sleeper_league_settings.username`). This is an
ASSOCIATION, not cryptographic ownership verification. The flow:
`listImportLeagues()` -> `listLeagueTrades(leagueId)` (verifies the league
belongs to the saved username, runs `pulseLeague` (cached), reads `trade`
transactions) -> `importAndAnalyze(...)`: maps `adds` (sleeper_player_id ->
roster_id) to two sides, maps players via `players.external_ids->>sleeper`
(blocks on any unmatched player), derives the format from Sleeper settings with
evidence, includes dynasty picks (`normalizeDraftPicks`, slot unknown -> generic
value) or excludes them in redraft with a notice, runs the pipeline
(`formatAutoDetected: true`), and optionally saves with the private
`sleeper_context` and `format_detection_evidence`. Only two-team trades are
supported in V1. Imported league/team context stays private unless the user
creates a public share, and even then only the trade summary is exposed.

## Admin

`/admin/signal-check` (Settings), `/rules` (rule builder: draft rulesets,
Zod-validated rule CRUD, publish, rollback, version history), `/regression`
(case CRUD with JSON-defined trades validated by `analysisInputSchema`, run
against the active ruleset or a draft, flag verdict flips / margin drift /
shape + confidence changes). All mutations re-check `requireAdmin` and append a
`signal_check_audit_log` row. Gated by `lib/admin-auth.ts requireAdmin` at the
layout, page, and action levels (defense in depth) and listed in
`components/admin-nav.tsx NAV_ITEMS`.

## Reproducibility / versioning

For V1 the frozen `signal_check_analyses` row IS the snapshot (no separate
named-snapshot table). It stores raw + adjusted per-asset values, pre/post side
totals, the full trace, the three version pins
(`value_engine_version`/`rule_interpreter_version`/`ruleset_version`), and
`value_captured_at`. Public permalinks render from `public_payload` and never
recompute. Bump `VALUE_ENGINE_VERSION` when value math changes; bump
`RULE_INTERPRETER_VERSION` when interpreter semantics change; settings/ruleset
content changes are captured by the ruleset version instead.

## Abuse protection (lightweight, by design)

No custom rate-limit table or RPC. Protection = bounded inputs (max assets per
side, id-length bounds, Zod validation), min query length + debounce + result
clamp on autocomplete, cached `pulseLeague` for Sleeper, server-side compute,
CDN-cached OG, `x-requested-with` header checks, and `requireAdmin` on admin
surfaces. Heavier rate limiting is deferred until real abuse appears.

## Testing

`npm test` runs the Vitest suites in `lib/signal-check/*.test.ts`: margin
normalization, neutral threshold, winner/near-even/blowout, compounding
(sequential + against-base), pile-on (once per side, capped, no opposite-side
boost), no double-counting, stackability, confidence, trade-shape detection,
Zod schema validation, redraft-rejects-picks, dynasty-allows-picks, generic
pick fallback, missing values, frozen reproducibility, public_payload privacy,
and rules-through-pipeline. The regression set doubles as a calibration
fixture.

## How to extend

- New setting: add a `beacon_settings` row (signal_check* category) in a
  migration, add the field to `SignalCheckSettings` + `DEFAULT_SETTINGS` +
  `buildSettings()`. The admin Settings page picks it up automatically.
- New rule condition/action: extend `rules/schema.ts` (keep `superRefine`
  coherence), handle it in `rules/interpreter.ts`, bump
  `RULE_INTERPRETER_VERSION`, add a test.
- New trade-shape: add a key in `detectShapeKey()` and a
  `signal_check_shape_*` label setting.
- New value source (post-V1): this is intentionally gated. V1 hardcodes
  `ffbeacon`. A public source selector would touch `format.ts`,
  `values.ts`, `freeze.ts` (snapshot source), and the builder.

## Known limitations / future work

- V1 supports only the formats FF Beacon publishes values for, so
  `redraft-half`, `redraft-standard`, and `redraft-ppr-tep` are not selectable.
- Sleeper import handles two-team trades only.
- Regression cases are authored as validated JSON (no point-and-click capture).
- Rule ordering is via the `sort_order` field (no drag-and-drop).
- `notFound()`/`redirect()` on the force-dynamic share/import pages return HTTP
  200 with the correct UI (Next App Router streaming quirk); add a route-level
  `not-found.tsx` if strict status codes are later required.
- Admin source-comparison tooling is explicitly out of public V1.
