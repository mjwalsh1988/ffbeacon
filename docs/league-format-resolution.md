# League Sync — format resolution

## TL;DR

Inside a specific Sleeper league view (`/leagues/[id]` and descendants),
the format used for player-value lookups is derived from the league's
actual Sleeper scoring rules, **not** from the user's global format
toggle. Source remains user-controlled. Draft pick values always come
from KTC regardless of the chosen player-value source.

This rule applies to every page under `/leagues/[id]/**`, plus the
`/api/og/*` image routes that render values from those views.

## Why

Every league has fixed real-world scoring rules. Showing a Redraft
Half-PPR value for a player whose owner plays in a Dynasty Superflex
league produces a number that's flat-out wrong for trade decisions.
The global format toggle exists for the rest of the site (rankings,
player pages, vote matchups) where the user is browsing in the
abstract; inside their *actual* league it's the wrong abstraction.

## Resolution chain

`lib/league-format-resolution.ts → resolveLeagueContext()` is the
single source of truth. It accepts a `SleeperLeague` (already fetched
into `leagues.metadata` during sync) and a candidate source slug,
and returns a `LeagueContext`.

The chain (each step strictly tighter than the next):

1. Derive the ideal `format_config` slug from the Sleeper league
   settings via `deriveLeagueFormat()`:
   - `scoring_settings.rec` decides PPR / Half / Standard
   - `roster_positions` containing `SUPER_FLEX` or 2+ QB starters
     decides Superflex
   - `scoring_settings.bonus_rec_te` or `rec_te` >= 0.5 decides TEP
   - `settings.type === 2` or `previous_league_id` decides Dynasty
2. If the user's chosen source supports the ideal format → use it.
3. Otherwise, fall back via `pickFallbackFormat()` to the closest
   format the source does support (same `league_type` → same
   `scoring_type` → same `is_superflex` → lowest `display_order`).
4. If the source supports nothing that maps at all, the context
   returns `coverage: 'none'` and the UI renders an empty state with
   plain-language description of the league shape
   (`describeDerived()`).

## Draft pick values

FantasyCalc does not publish draft pick values. KTC is currently the
only source whose `source_registry.data_type` includes
`draft_pick_values`. To avoid spurious zero-value picks in trade
analyses, picks ALWAYS look up against the highest-priority source
that publishes them — today that's KTC, even when player values come
from FantasyCalc.

When this fallback is active, `LeagueContext.pickSource` is non-null
and the UI surfaces a "Draft pick values powered by KTC" footnote.
This is documented in:

- `lib/league-format-resolution.ts` → `pickSourceForDraftPicks()`
- `lib/trade-analyzer.ts` → reads `context.pickSourceSlug` for pick
  value lookups
- `components/transaction-row.tsx` → renders the footnote when
  `pickSourceSlug !== sourceSlug`

## Behavior summary

| Scenario | What happens |
| --- | --- |
| User has FantasyCalc selected, league is Dynasty PPR | Player values from FantasyCalc dynasty-ppr-std; pick values from KTC dynasty-ppr-std. Footnote shown. |
| User has FantasyCalc selected, league is Dynasty Superflex TEP | FantasyCalc doesn't cover TEP, so fall back to dynasty-ppr-sflex on FantasyCalc. Picks from KTC dynasty-ppr-sflex (TEP is a no-op for picks). Banner explains the format swap. |
| User has KTC selected, league is Dynasty PPR Superflex TEP | Exact match — KTC publishes dynasty-ppr-tep-sflex. No fallback. No footnote. |
| User has KTC selected, league is Redraft Half PPR | KTC doesn't publish redraft half PPR, fall back to redraft-ppr-std. Banner explains the swap. |
| Custom league rules with no canonical mapping | `coverage: 'none'`. UI shows the league's plain-language description and notes that values are unavailable. |

## Why the global format toggle is hidden inside league views

The global `<FormatToggle />` in the site header is still rendered on
non-league pages but **does not affect** values inside `/leagues/[id]`.
Pages under that path ignore `?format=` URL params and the
`ffbeacon.format` cookie when resolving values. Source is still
respected because users have a legitimate "I prefer KTC" or "I prefer
FantasyCalc" preference that travels with them across leagues.

This will change when FF Beacon's own native rankings ship with custom
scoring support. At that point the Format toggle's "My leagues" group
(see plan.md → "Future: User Custom Scoring Formats") will let users
pin a league's exact scoring rules, and the league-context resolver
will prefer that custom format over the canonical map.

## Verifying for a new league

1. Open `/leagues/[id]` and confirm the header reads "League format:
   {derived}" where derived describes Sleeper's actual rules.
2. If you see a banner "Showing values for X because {source} doesn't
   publish data for Y", that's the fallback path — verify Y matches
   `describeDerived(context.derived)`.
3. Switch source in the header and re-open the league view. The
   format should auto-resolve again; values should change accordingly.
4. If you see "No data source covers {derived}", you've found a league
   format we don't carry yet. Log it; we'll add `format_configs` rows
   in a future migration.
